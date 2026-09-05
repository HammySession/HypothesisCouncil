import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { isAbsolute, join, relative, resolve, sep } from 'path';
import { buildContextPacket, isGlobPattern, type BuiltContext } from '../../research/context.js';
import { formatBytes } from '../format.js';

/**
 * The context basket: paths, glob patterns, and pasted snippets a person collects in the shell
 * so chat questions and `/run` can share them. Snippets are materialised as Markdown files under
 * `<session home>/basket/` so the ordinary context builder (with its denial rules and byte
 * budget) handles everything.
 */

export interface BasketSnippet {
  label: string;
  path: string;
  bytes: number;
}

export interface ContextBasket {
  /** Paths and glob patterns relative to the repository root (absolute paths stay absolute). */
  paths: string[];
  snippets: BasketSnippet[];
  markdownOnly: boolean;
}

export function createBasket(): ContextBasket {
  return { paths: [], snippets: [], markdownOnly: false };
}

export function basketSize(basket: ContextBasket): number {
  return basket.paths.length + basket.snippets.length;
}

function normalisePath(value: string): string {
  return value.trim().replace(/[\\/]+$/, '') || '.';
}

/** Add paths or patterns; missing plain paths are reported, not added. */
export function addBasketPaths(
  basket: ContextBasket,
  values: string[],
  repoRoot: string
): { added: string[]; duplicates: string[]; missing: string[] } {
  const added: string[] = [];
  const duplicates: string[] = [];
  const missing: string[] = [];
  for (const raw of values) {
    const value = normalisePath(raw);
    if (!isGlobPattern(value) && !existsSync(resolve(repoRoot, value))) {
      missing.push(value);
      continue;
    }
    if (basket.paths.includes(value)) {
      duplicates.push(value);
      continue;
    }
    basket.paths.push(value);
    added.push(value);
  }
  return { added, duplicates, missing };
}

/** Remove a path, pattern, or snippet label. */
export function removeBasketPath(basket: ContextBasket, value: string): boolean {
  const wanted = normalisePath(value);
  const pathIndex = basket.paths.indexOf(wanted);
  if (pathIndex >= 0) {
    basket.paths.splice(pathIndex, 1);
    return true;
  }
  const snippetIndex = basket.snippets.findIndex(
    (snippet) => snippet.label === value.trim() || snippet.path === wanted
  );
  if (snippetIndex >= 0) {
    basket.snippets.splice(snippetIndex, 1);
    return true;
  }
  return false;
}

export function clearBasket(basket: ContextBasket): void {
  basket.paths.length = 0;
  basket.snippets.length = 0;
}

function safeLabel(label: string): string {
  return (
    label
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'snippet'
  );
}

/** Materialise pasted text as `<home>/basket/<nn>-<label>.md` and add it to the basket. */
export function addBasketSnippet(
  basket: ContextBasket,
  home: string,
  label: string,
  text: string
): BasketSnippet {
  const body = text.trim();
  if (!body) throw new Error('The snippet is empty; nothing was added');
  const directory = join(home, 'basket');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const existing = readdirSync(directory).filter((name) => /^\d{2,}-/.test(name)).length;
  const path = join(directory, `${String(existing + 1).padStart(2, '0')}-${safeLabel(label)}.md`);
  const contents = `# ${label.trim() || 'Snippet'}\n\n${body}\n`;
  writeFileSync(path, contents, { encoding: 'utf8', mode: 0o600 });
  const snippet = { label: label.trim() || 'Snippet', path, bytes: Buffer.byteLength(contents) };
  basket.snippets.push(snippet);
  return snippet;
}

/** Everything the basket selects, as context paths for the builder or `--context`. */
export function basketPaths(basket: ContextBasket): string[] {
  return [...basket.paths, ...basket.snippets.map((snippet) => snippet.path)];
}

export function buildBasketPacket(
  basket: ContextBasket,
  repoRoot: string,
  maxBytes: number
): BuiltContext {
  return buildContextPacket(basketPaths(basket), maxBytes, repoRoot, {
    markdownOnly: basket.markdownOnly,
  });
}

function shown(path: string, repoRoot: string): string {
  if (!isAbsolute(path)) return path;
  const local = relative(repoRoot, path);
  return local && !local.startsWith('..') ? local.split(sep).join('/') : path;
}

/** Lines for `/context` and the pre-send preview. */
export function basketLines(basket: ContextBasket, repoRoot: string): string[] {
  if (basketSize(basket) === 0) {
    return [
      'Context basket: empty. Add files with /context add PATH|GLOB, paste text with /context add-text LABEL, or mention @path in a message.',
    ];
  }
  const lines = [
    `Context basket (${basketSize(basket)} item${basketSize(basket) === 1 ? '' : 's'}${basket.markdownOnly ? ', Markdown only' : ''}):`,
  ];
  for (const path of basket.paths) lines.push(`  ${shown(path, repoRoot)}`);
  for (const snippet of basket.snippets) {
    lines.push(`  ${snippet.label} (pasted, ${formatBytes(snippet.bytes)})`);
  }
  return lines;
}

export function basketPreviewLines(built: BuiltContext, basket: ContextBasket): string[] {
  const { manifest } = built;
  const lines = [
    `Context basket: ${manifest.files.length} file${manifest.files.length === 1 ? '' : 's'}, ${formatBytes(manifest.packetBytes)} of ${formatBytes(manifest.maxBytes)}${basket.markdownOnly ? ' (Markdown only)' : ''}`,
  ];
  for (const file of manifest.files.slice(0, 20)) lines.push(`  + ${file.path}`);
  if (manifest.files.length > 20) lines.push(`  … and ${manifest.files.length - 20} more`);
  for (const path of manifest.deniedPaths.slice(0, 10)) lines.push(`  - denied ${path}`);
  if (manifest.unmatchedRequestedPaths?.length) {
    lines.push(`  ! no files matched: ${manifest.unmatchedRequestedPaths.join(', ')}`);
  }
  if (basket.snippets.length > 0) {
    lines.push('  Pasted snippets are sent verbatim; they are not secret-filtered.');
  }
  return lines;
}
