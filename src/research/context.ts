import { createHash } from 'crypto';
import { lstatSync, readFileSync, readdirSync } from 'fs';
import { basename, extname, join, relative, resolve, sep } from 'path';
import type { ContextFileRecord, ContextManifest } from './types.js';

const DEFAULT_MAX_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx']);
const ALLOWED_EXTENSIONS = new Set([
  ...MARKDOWN_EXTENSIONS,
  '.txt',
  '.lock',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.xml',
  '.csv',
  '.py',
  '.r',
  '.rb',
  '.php',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.vue',
  '.svelte',
  '.html',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.java',
  '.kt',
  '.kts',
  '.go',
  '.mod',
  '.rs',
  '.swift',
  '.scala',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.sql',
  '.graphql',
  '.proto',
  '.tf',
  '.hcl',
]);
const ALLOWED_FILENAMES = new Set(['dockerfile', 'makefile', 'justfile', 'procfile', 'license']);

const DENIED_SEGMENTS = new Set([
  '.git',
  '.ssh',
  '.aws',
  '.gnupg',
  'node_modules',
  'coverage',
  'dist',
  'build',
  'target',
  '.next',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
]);

const DENIED_FILE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /credentials?/i,
  /private[-_.]?key/i,
  /id_(?:rsa|dsa|ecdsa|ed25519)/i,
  /cookies?\.sqlite/i,
  /git-credentials/i,
  /^settings\.local\.json$/i,
  /^\.(?:npmrc|pypirc|netrc)$/i,
  /\.(?:pem|p12|pfx|key)$/i,
];

const ROOT_PRIORITY_FILES = new Set([
  'agents.md',
  'claude.md',
  'readme.md',
  'package.json',
  'pyproject.toml',
  'cargo.toml',
  'go.mod',
  'requirements.txt',
]);

export interface ContextBuildOptions {
  markdownOnly?: boolean;
  maxFileBytes?: number;
}

export interface BuiltContext {
  manifest: ContextManifest;
  packet: string;
}

interface CollectedFile {
  absolutePath: string;
  shownPath: string;
  contents: Buffer;
  textBytes: Buffer;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Manifest paths are repository-relative and always use `/` separators so packets, reports, and
 * session JSON are identical across operating systems.
 */
function displayPath(path: string, cwd: string): string {
  const local = relative(cwd, path);
  const shown = local && local !== '..' && !local.startsWith(`..${sep}`) ? local : path;
  return shown.split(sep).join('/');
}

function isDenied(path: string): boolean {
  const parts = path.split(sep);
  const filename = parts.at(-1) || '';
  return (
    parts.some((part) => DENIED_SEGMENTS.has(part)) ||
    DENIED_FILE_PATTERNS.some((pattern) => pattern.test(filename))
  );
}

/** A requested context path containing `*` or `?` is treated as a glob pattern, not a file path. */
export function isGlobPattern(value: string): boolean {
  return /[*?]/.test(value);
}

function globSegmentToRegExp(segment: string): RegExp {
  const escaped = segment
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/**
 * Deterministic glob expansion relative to the repository root. Supports `*` and `?` within a
 * path segment and `**` for any number of directories. A matched directory selects its whole
 * subtree, like passing the directory itself. Denied directories are never traversed, so a broad
 * pattern such as `**\/*.ts` cannot flood the manifest with `node_modules` denials; a leaf match
 * on a denied file is still recorded by the normal visit so the denial stays visible.
 */
function expandGlobPattern(pattern: string, cwd: string, visit: (path: string) => void): void {
  const parts = pattern.split(/[\\/]+/).filter((part) => part.length > 0 && part !== '.');
  const splitIndex = parts.findIndex((part) => isGlobPattern(part));
  const baseParts = splitIndex === -1 ? parts : parts.slice(0, splitIndex);
  const patternParts = splitIndex === -1 ? [] : parts.slice(splitIndex);
  const startDirectory = resolve(cwd, baseParts.join('/') || '.');

  const walk = (directory: string, segments: string[]): void => {
    if (segments.length === 0) {
      visit(directory);
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(directory).sort();
    } catch {
      return;
    }
    const [segment, ...rest] = segments;
    if (segment === '**') {
      walk(directory, rest);
      for (const entry of entries) {
        const path = join(directory, entry);
        if (DENIED_SEGMENTS.has(entry)) continue;
        let stat;
        try {
          stat = lstatSync(path);
        } catch {
          continue;
        }
        if (stat.isDirectory() && !stat.isSymbolicLink()) walk(path, segments);
      }
      return;
    }
    const matcher = globSegmentToRegExp(segment);
    for (const entry of entries) {
      if (!matcher.test(entry)) continue;
      const path = join(directory, entry);
      if (rest.length === 0) {
        visit(path);
        continue;
      }
      if (DENIED_SEGMENTS.has(entry)) continue;
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        continue;
      }
      if (stat.isDirectory() && !stat.isSymbolicLink()) walk(path, rest);
    }
  };

  walk(startDirectory, patternParts);
}

function priority(path: string): number {
  const normalized = path.split(sep).join('/').toLowerCase();
  const name = basename(normalized);
  if (!normalized.includes('/') && ROOT_PRIORITY_FILES.has(name)) return 0;
  if (MARKDOWN_EXTENSIONS.has(extname(name))) return 10;
  if (/(^|\/)(docs?|research|design)(\/|$)/.test(normalized)) return 15;
  if (/(^|\/)(src|app|lib|packages?)(\/|$)/.test(normalized)) return 20;
  if (/(^|\/)(tests?|specs?)(\/|$)/.test(normalized)) return 40;
  return 30;
}

function collectFiles(
  requestedPaths: string[],
  cwd: string,
  markdownOnly: boolean
): {
  files: CollectedFile[];
  deniedPaths: string[];
  omittedPaths: string[];
  unmatchedRequestedPaths: string[];
} {
  const paths = new Set<string>();
  const deniedPaths: string[] = [];
  const omittedPaths: string[] = [];
  const unmatchedRequestedPaths: string[] = [];
  const allowed = markdownOnly ? MARKDOWN_EXTENSIONS : ALLOWED_EXTENSIONS;
  let eligibleMatches = 0;

  const visit = (path: string) => {
    const shown = displayPath(path, cwd);
    if (isDenied(path)) {
      deniedPaths.push(shown);
      return;
    }
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      omittedPaths.push(shown);
      return;
    }
    if (stat.isSymbolicLink()) {
      deniedPaths.push(shown);
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) visit(resolve(path, entry));
      return;
    }
    const filename = basename(path).toLowerCase();
    if (
      !stat.isFile() ||
      (!allowed.has(extname(path).toLowerCase()) &&
        !(markdownOnly === false && ALLOWED_FILENAMES.has(filename)))
    ) {
      omittedPaths.push(shown);
      return;
    }
    paths.add(path);
    eligibleMatches++;
  };

  const requests = requestedPaths
    .map((value) => ({
      value: value.split(sep).join('/'),
      resolved: isGlobPattern(value) ? undefined : resolve(cwd, value),
    }))
    .sort((left, right) => (left.resolved ?? left.value).localeCompare(right.resolved ?? right.value));
  for (const request of requests) {
    eligibleMatches = 0;
    if (request.resolved !== undefined) visit(request.resolved);
    else expandGlobPattern(request.value, cwd, visit);
    if (eligibleMatches === 0) unmatchedRequestedPaths.push(request.value);
  }
  const files = [...paths]
    .map((absolutePath) => {
      const contents = readFileSync(absolutePath);
      return {
        absolutePath,
        shownPath: displayPath(absolutePath, cwd),
        contents,
        textBytes: Buffer.from(contents.toString('utf8'), 'utf8'),
      };
    })
    .sort(
      (left, right) =>
        priority(left.shownPath) - priority(right.shownPath) ||
        left.shownPath.localeCompare(right.shownPath)
    );
  return { files, deniedPaths, omittedPaths, unmatchedRequestedPaths };
}

function buildRepositoryManifest(files: CollectedFile[], maxBytes: number): string {
  if (files.length === 0 || maxBytes < 128) return '';
  const start = '===== REPOSITORY FILE MANIFEST =====\n';
  const end = '===== END REPOSITORY FILE MANIFEST =====';
  const limit = Math.min(MAX_MANIFEST_BYTES, Math.floor(maxBytes * 0.2));
  if (byteLength(start + end) > limit) return '';
  const lines: string[] = [];
  let used = byteLength(start + end);
  for (let index = 0; index < files.length; index++) {
    const line = `${files[index].shownPath} (${files[index].contents.byteLength} bytes)\n`;
    const remainingCount = files.length - index;
    const omitted = `... ${remainingCount} additional paths omitted from manifest\n`;
    if (used + byteLength(line) <= limit) {
      lines.push(line);
      used += byteLength(line);
      continue;
    }
    if (used + byteLength(omitted) <= limit) lines.push(omitted);
    break;
  }
  return `${start}${lines.join('')}${end}`;
}

function sectionOverhead(path: string): number {
  return byteLength(`===== FILE: ${path} =====\n\n===== END FILE =====`);
}

function utf8Prefix(buffer: Buffer, maxBytes: number): Buffer {
  let end = Math.min(buffer.byteLength, maxBytes);
  if (end === buffer.byteLength || end === 0) return buffer.subarray(0, end);
  let start = end - 1;
  while (start > 0 && (buffer[start] & 0xc0) === 0x80) start--;
  const lead = buffer[start];
  const width = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4;
  if (start + width > end) end = start;
  return buffer.subarray(0, end);
}

export function buildContextPacket(
  requestedPaths: string[],
  maxBytes = DEFAULT_MAX_BYTES,
  cwd = process.cwd(),
  options: ContextBuildOptions = {}
): BuiltContext {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('maxBytes must be a positive integer');
  }
  if (
    options.maxFileBytes !== undefined &&
    (!Number.isInteger(options.maxFileBytes) || options.maxFileBytes <= 0)
  ) {
    throw new Error('maxFileBytes must be a positive integer');
  }
  const collected = collectFiles(requestedPaths, cwd, options.markdownOnly === true);
  const repositoryManifest = buildRepositoryManifest(collected.files, maxBytes);
  const manifestSeparator = repositoryManifest ? 2 : 0;
  const availableAfterManifest = maxBytes - byteLength(repositoryManifest) - manifestSeparator;
  const maxFileBytes = options.maxFileBytes ?? Number.MAX_SAFE_INTEGER;
  let selected = collected.files.filter((file) => file.textBytes.byteLength > 0);

  while (selected.length > 0) {
    const overhead =
      selected.reduce((total, file) => total + sectionOverhead(file.shownPath), 0) +
      Math.max(0, selected.length - 1) * 2;
    if (availableAfterManifest - overhead >= selected.length) break;
    selected = selected.slice(0, -1);
  }

  const overhead =
    selected.reduce((total, file) => total + sectionOverhead(file.shownPath), 0) +
    Math.max(0, selected.length - 1) * 2;
  const contentBudget = Math.max(0, availableAfterManifest - overhead);
  const allocations = new Map<string, number>();
  const fairShare = selected.length === 0 ? 0 : Math.floor(contentBudget / selected.length);
  let remaining = contentBudget;
  for (const file of selected) {
    const allocated = Math.min(file.textBytes.byteLength, maxFileBytes, fairShare);
    allocations.set(file.absolutePath, allocated);
    remaining -= allocated;
  }
  for (const file of selected) {
    if (remaining <= 0) break;
    const current = allocations.get(file.absolutePath) || 0;
    const additional = Math.min(
      remaining,
      Math.max(0, Math.min(file.textBytes.byteLength, maxFileBytes) - current)
    );
    allocations.set(file.absolutePath, current + additional);
    remaining -= additional;
  }

  const records: ContextFileRecord[] = [];
  const sections: string[] = [];
  let totalBytes = 0;
  let includedBytes = 0;
  for (const file of collected.files) {
    totalBytes += file.contents.byteLength;
    const allocated = allocations.get(file.absolutePath) || 0;
    if (allocated === 0) {
      collected.omittedPaths.push(file.shownPath);
      continue;
    }
    const included = utf8Prefix(file.textBytes, allocated);
    if (included.byteLength === 0) {
      collected.omittedPaths.push(file.shownPath);
      continue;
    }
    records.push({
      path: file.shownPath,
      bytes: file.contents.byteLength,
      sha256: sha256(file.contents),
      includedBytes: included.byteLength,
      truncated: included.byteLength < file.textBytes.byteLength,
    });
    sections.push(
      `===== FILE: ${file.shownPath} =====\n${included.toString('utf8')}\n===== END FILE =====`
    );
    includedBytes += included.byteLength;
  }

  const packetParts = [repositoryManifest, ...sections].filter(Boolean);
  const packet = packetParts.join('\n\n') || '(No research context files supplied.)';
  const packetBytes = byteLength(packet);
  if (packetBytes > maxBytes) {
    throw new Error(`Context packet exceeded its ${maxBytes}-byte budget`);
  }
  return {
    packet,
    manifest: {
      files: records,
      deniedPaths: [...new Set(collected.deniedPaths)].sort(),
      omittedPaths: [...new Set(collected.omittedPaths)].sort(),
      unmatchedRequestedPaths: [...new Set(collected.unmatchedRequestedPaths)].sort(),
      totalBytes,
      includedBytes,
      packetBytes,
      maxBytes,
      packetSha256: sha256(packet),
    },
  };
}
