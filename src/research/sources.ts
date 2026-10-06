import { readFileSync } from 'fs';
import { extname } from 'path';

/**
 * Source records the council may cite: literature, datasets, documentation, or code the person
 * supplied with `--sources`, plus records web scouts proposed. Records travel with the session,
 * are rendered into a SOURCES appendix of the context packet, and are checked mechanically before
 * a hypothesis may cite them as `source` evidence.
 */

export type SourceOrigin = 'user' | 'scout';

export const SOURCE_KINDS = [
  'paper',
  'preprint',
  'dataset',
  'code',
  'documentation',
  'article',
  'other',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export type SourceVerificationStatus =
  | 'reachable'
  | 'unreachable'
  | 'blocked'
  | 'skipped'
  | 'retracted';

export type SourceReplication = 'replicated' | 'unreplicated' | 'contested' | 'unknown';

export interface SourceVerificationRecord {
  status: SourceVerificationStatus;
  checkedAt: string;
  httpStatus?: number;
  /** Where the fetch ended after redirects. */
  finalUrl?: string;
  /** SHA-256 of the bytes read (capped), so a later run can tell whether the page changed. */
  contentSha256?: string;
  /** Whether the record's title was found in the fetched text; absent for non-text bodies. */
  titleFound?: boolean;
  /** Retraction lookup outcome when the record has a DOI and the mode asked for it. */
  retraction?: { checked: boolean; notice?: string };
  error?: string;
}

export interface SourceCritiqueRecord {
  /** 1 (unreliable) to 10 (authoritative, replicated), graded by a council provider. */
  reliability: number;
  replication: SourceReplication;
  concerns: string[];
}

export interface SourceRecord {
  /** `S-001`, `S-002`, ... stable for the life of the session. */
  id: string;
  title: string;
  url?: string;
  doi?: string;
  year?: number;
  venue?: string;
  /** Model- or person-written description; always shown as unverified in the packet. */
  summary?: string;
  origin: SourceOrigin;
  kind: SourceKind;
  /** Scout provider that proposed the record. Private: stripped from public output. */
  scoutProvider?: string;
  verification?: SourceVerificationRecord;
  critique?: SourceCritiqueRecord;
}

/** A record before it has an id, as parsed from a sources file or a scout reply. */
export type SourceInput = Omit<SourceRecord, 'id' | 'origin' | 'kind' | 'year'> & {
  origin?: SourceOrigin;
  kind?: string;
  year?: number | string;
};

export const SOURCES_SECTION_BEGIN = '===== SOURCES =====';
export const SOURCES_SECTION_END = '===== END SOURCES =====';

/**
 * Providers whose name ends in `-scout` or `_scout` are web scouts: they may search the web to
 * propose sources, and they never sit on the council. Rubber Duck lowercases custom provider
 * names, so `CLI_CUSTOM_CLAUDE_SCOUT_*` becomes `cli-claude_scout`.
 */
export const SCOUT_NAME_PATTERN = /[-_]scout$/i;

export function isScoutProvider(name: string): boolean {
  return SCOUT_NAME_PATTERN.test(name);
}

const DOI_PATTERN = /\b(10\.\d{4,9}\/[^\s"'<>)\]]+)/i;
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;
const TRACKING_PARAMETERS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|ref_src$)/i;

/** Lower-case, `doi:`- and resolver-free form of a DOI, or undefined when it is not one. */
export function normalizeDoi(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const stripped = value
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  const match = DOI_PATTERN.exec(stripped);
  return match ? match[1].replace(/[.,;:]+$/, '').toLowerCase() : undefined;
}

/**
 * Canonical form used to deduplicate URLs: lower-case scheme and host, no fragment, no tracking
 * parameters, no trailing slash. Returns undefined for anything that is not an http(s) URL.
 */
export function canonicalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  parsed.hash = '';
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMETERS.test(key)) parsed.searchParams.delete(key);
  }
  parsed.hostname = parsed.hostname.toLowerCase();
  let text = parsed.toString();
  if (text.endsWith('?')) text = text.slice(0, -1);
  if (parsed.pathname !== '/' && text.endsWith('/')) text = text.slice(0, -1);
  if (parsed.pathname === '/' && !parsed.search && text.endsWith('/')) text = text.slice(0, -1);
  return text;
}

function normalizeKind(value: string | undefined): SourceKind {
  const kind = value?.trim().toLowerCase();
  return (SOURCE_KINDS as readonly string[]).includes(kind ?? '') ? (kind as SourceKind) : 'other';
}

function normalizeYear(value: unknown): number | undefined {
  const year = typeof value === 'string' ? Number(value.trim()) : value;
  return typeof year === 'number' && Number.isInteger(year) && year >= 1000 && year <= 2100
    ? year
    : undefined;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function recordFromObject(value: unknown): SourceInput | undefined {
  if (typeof value === 'string') return recordFromLine(value);
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  const url = asString(item.url) ?? asString(item.link) ?? asString(item.href);
  const doi = normalizeDoi(asString(item.doi));
  const title =
    asString(item.title) ?? asString(item.name) ?? url ?? (doi ? `doi:${doi}` : undefined);
  if (!title) return undefined;
  return {
    title,
    url,
    doi,
    year: normalizeYear(item.year),
    venue: asString(item.venue) ?? asString(item.journal) ?? asString(item.publisher),
    summary: asString(item.summary) ?? asString(item.notes) ?? asString(item.description),
    kind: asString(item.kind) ?? asString(item.type),
  };
}

/**
 * One Markdown or plain-text line: `- [Title](url)`, `- Title - url` (any dash), `- url`, or a line with a
 * DOI. Lines without a URL or DOI are kept as title-only records (a book, say) and are never
 * fetched.
 */
export function recordFromLine(line: string): SourceInput | undefined {
  const text = line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*\[\s*[x ]?\s*\]\s*/i, '')
    .trim();
  if (!text || text.startsWith('#')) return undefined;
  const link = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/.exec(text);
  const urls = text.match(URL_PATTERN) ?? [];
  const url = link?.[2] ?? urls[0];
  const doi = normalizeDoi(text);
  let title = link?.[1]?.trim();
  if (!title) {
    title = text
      .replace(URL_PATTERN, '')
      .replace(/\bdoi:\s*\S+/i, '')
      .replace(/\b10\.\d{4,9}\/\S+/i, '')
      .replace(/[\s\-–—:|,(]+$/g, '')
      .replace(/^[\s\-–—:|,)]+/g, '')
      .trim();
  }
  if (!title) title = url ?? (doi ? `doi:${doi}` : '');
  if (!title) return undefined;
  const year = /\b((?:19|20)\d{2})\b/.exec(
    text.replace(URL_PATTERN, '').replace(/\b10\.\d{4,9}\/\S+/i, '')
  )?.[1];
  return { title, url, doi, year: year ? Number(year) : undefined };
}

/**
 * Parse a sources file: JSON (`{"sources": [...]}` or a bare array of records or strings) or
 * Markdown/plain text with one source per line. Every record becomes a user-supplied source.
 */
export function parseSourcesText(contents: string, filename = 'sources'): SourceInput[] {
  const trimmed = contents.trim();
  if (!trimmed) return [];
  const looksJson =
    extname(filename).toLowerCase() === '.json' ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[');
  if (looksJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(
        `Sources file ${filename} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const items = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as { sources?: unknown }).sources)
        ? (parsed as { sources: unknown[] }).sources
        : undefined;
    if (!items) {
      throw new Error(
        `Sources file ${filename} must be a JSON array or an object with a "sources" array`
      );
    }
    return items.map(recordFromObject).filter((record): record is SourceInput => Boolean(record));
  }
  return trimmed
    .split(/\r?\n/)
    .map(recordFromLine)
    .filter((record): record is SourceInput => Boolean(record));
}

export function parseSourcesFile(path: string): SourceInput[] {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Sources file not found: ${path}`);
  }
  return parseSourcesText(contents, path);
}

function nextSourceNumber(existing: SourceRecord[]): number {
  return existing.reduce((highest, record) => {
    const number = Number(/^S-(\d+)$/.exec(record.id)?.[1] ?? 0);
    return Math.max(highest, number);
  }, 0);
}

export function sourceId(number: number): string {
  return `S-${String(number).padStart(3, '0')}`;
}

/**
 * Append new records to an existing list, dropping duplicates (same DOI, same canonical URL, or
 * same normalized title) and numbering the survivors after the existing ids. Existing records are
 * returned untouched so ids never move once assigned.
 */
export function normalizeSources(
  existing: SourceRecord[],
  additions: SourceInput[],
  origin: SourceOrigin,
  scoutProvider?: string
): { sources: SourceRecord[]; added: SourceRecord[]; duplicates: number } {
  const dois = new Set(existing.map((record) => record.doi).filter(Boolean));
  const urls = new Set(existing.map((record) => canonicalUrl(record.url)).filter(Boolean));
  const titles = new Set(existing.map((record) => normalizeTitle(record.title)));
  let number = nextSourceNumber(existing);
  const added: SourceRecord[] = [];
  let duplicates = 0;
  for (const input of additions) {
    const doi = normalizeDoi(input.doi) ?? normalizeDoi(input.url);
    const url = canonicalUrl(input.url);
    const title = normalizeTitle(input.title);
    if ((doi && dois.has(doi)) || (url && urls.has(url)) || (title && titles.has(title))) {
      duplicates++;
      continue;
    }
    if (doi) dois.add(doi);
    if (url) urls.add(url);
    if (title) titles.add(title);
    number++;
    const record: SourceRecord = {
      id: sourceId(number),
      title: input.title.trim(),
      url: url ?? (input.url?.trim() || undefined),
      doi,
      year: normalizeYear(input.year),
      venue: input.venue?.trim() || undefined,
      summary: input.summary?.trim() || undefined,
      origin: input.origin ?? origin,
      kind: normalizeKind(input.kind),
      scoutProvider: origin === 'scout' ? scoutProvider : undefined,
    };
    for (const key of Object.keys(record) as Array<keyof SourceRecord>) {
      if (record[key] === undefined) delete record[key];
    }
    added.push(record);
  }
  return { sources: [...existing, ...added], added, duplicates };
}

/** The record without its private scout identity, for reports, status, and MCP output. */
export function publicSource(record: SourceRecord): Omit<SourceRecord, 'scoutProvider'> {
  const { scoutProvider: _scout, ...visible } = record;
  return visible;
}

function describeVerification(record: SourceRecord): string {
  const verification = record.verification;
  if (!verification) return 'unchecked';
  switch (verification.status) {
    case 'reachable':
      return verification.titleFound === false
        ? 'reachable (title not found on page)'
        : 'reachable';
    case 'retracted':
      return 'RETRACTED';
    case 'skipped':
      return record.url || record.doi ? 'not fetched' : 'no URL';
    default:
      return verification.status;
  }
}

function describeCritique(critique: SourceCritiqueRecord): string {
  const concerns =
    critique.concerns.length > 0 ? `; concerns: ${critique.concerns.join('; ')}` : '';
  return `reliability ${critique.reliability}/10, replication ${critique.replication}${concerns}`;
}

/** One packet line per record; summaries and critiques are labelled as model-written. */
export function renderSourceLine(record: SourceRecord): string {
  const meta = [record.year, record.venue].filter(Boolean).join(', ');
  const head = [
    record.id,
    record.kind,
    record.origin === 'user' ? 'user-supplied' : 'scouted',
    describeVerification(record),
    meta ? `${record.title} (${meta})` : record.title,
  ].join(' | ');
  const lines = [head];
  if (record.url) lines.push(`  url: ${record.url}`);
  if (record.doi) lines.push(`  doi: ${record.doi}`);
  if (record.summary) {
    lines.push(
      `  summary (${record.origin === 'user' ? 'as supplied' : 'model-written, unverified'}): ${record.summary}`
    );
  }
  if (record.critique)
    lines.push(`  critique (model-assessed): ${describeCritique(record.critique)}`);
  return lines.join('\n');
}

export function renderSourcesSection(sources: SourceRecord[]): string {
  const intro =
    'Records below were supplied with the run or proposed by web scouts. The verification field was set mechanically (the URL was fetched; reachable means it exists, not that it is correct). Summaries and critiques are model-written and unverified. Cite a record as evidence only with basis "source" and its id.';
  return [
    SOURCES_SECTION_BEGIN,
    intro,
    '',
    ...sources.map(renderSourceLine),
    SOURCES_SECTION_END,
  ].join('\n');
}

/**
 * Split a persisted packet into the file part and the SOURCES appendix, so context quotes are
 * checked against files only and a hypothesis cannot "verify" a quote from a source summary.
 */
export function splitAppendix(packet: string): { filePacket: string; appendix?: string } {
  const marker = `\n\n${SOURCES_SECTION_BEGIN}\n`;
  const start = packet.indexOf(marker);
  if (start === -1) {
    return packet.startsWith(`${SOURCES_SECTION_BEGIN}\n`)
      ? { filePacket: '', appendix: packet }
      : { filePacket: packet };
  }
  return { filePacket: packet.slice(0, start), appendix: packet.slice(start + 2) };
}

/** Sort key for trimming: user records first, then by reliability (unknown counts as 5), then id. */
export function sourcePriority(record: SourceRecord): number {
  const origin = record.origin === 'user' ? 0 : 100;
  const reliability = record.critique?.reliability ?? 5;
  return origin + (10 - reliability);
}
