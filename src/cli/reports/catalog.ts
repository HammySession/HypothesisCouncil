import type { ResearchSession } from '../../research/types.js';
import { formatDuration, orderedCandidates, stageLabel, table } from '../format.js';
import { deriveTags, normalizeTag } from './tags.js';

/**
 * The report catalog: one entry per persisted session with the labels a person browses by. It
 * carries titles, goals, tags, counts, and paths, never author or reviewer identities.
 */

export type ReportKind = 'research';

export interface ReportEntry {
  /** 1-based position in the listing, so `/open 2` can refer to it. */
  index: number;
  id: string;
  kind: ReportKind;
  title: string;
  goal: string;
  /** User tags first, then derived tags. */
  tags: string[];
  userTags: string[];
  createdAt: string;
  elapsedMs?: number;
  status: ResearchSession['status'];
  stage: ResearchSession['stage'];
  stageLabel: string;
  providerCount: number;
  configuredProviderCount: number;
  distinctCandidates: number;
  topCandidate?: string;
  preset?: string;
  markdownOnly: boolean;
  reportMarkdownPath?: string;
  /** `report.html` inside the session directory when it has been rendered. */
  htmlPath?: string;
  summary?: string;
}

export interface CatalogStore {
  artifactExists(sessionId: string, filename: string): boolean;
  artifactPath(sessionId: string, filename: string): string;
}

/** Wall-clock span of the provider calls (`updatedAt` moves on every save, so it is not used). */
export function sessionElapsedMs(session: ResearchSession): number | undefined {
  if (session.calls.length === 0) return undefined;
  const started = Math.min(...session.calls.map((call) => Date.parse(call.startedAt)));
  const ended = Math.max(...session.calls.map((call) => Date.parse(call.endedAt)));
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return undefined;
  return ended - started;
}

export function reportTitle(session: ResearchSession): string {
  return session.meta?.title?.trim() || session.goal;
}

function toEntry(session: ResearchSession, index: number, store?: CatalogStore): ReportEntry {
  const top = orderedCandidates(session)[0];
  const userTags = [...new Set((session.meta?.tags ?? []).map(normalizeTag).filter(Boolean))];
  const htmlPath =
    store && store.artifactExists(session.id, 'report.html')
      ? store.artifactPath(session.id, 'report.html')
      : undefined;
  return {
    index,
    id: session.id,
    kind: 'research',
    title: reportTitle(session),
    goal: session.goal,
    tags: deriveTags(session),
    userTags,
    createdAt: session.createdAt,
    elapsedMs: sessionElapsedMs(session),
    status: session.status,
    stage: session.stage,
    stageLabel: stageLabel(session),
    providerCount: session.providers.length,
    configuredProviderCount: session.config.providers.length,
    distinctCandidates: session.candidates.filter((candidate) => candidate.status === 'distinct')
      .length,
    topCandidate: top ? `${top.id} ${top.title}` : undefined,
    preset: session.meta?.preset,
    markdownOnly: session.config.markdownOnly === true,
    reportMarkdownPath: session.reportMarkdownPath,
    htmlPath,
    summary: session.meta?.summary,
  };
}

/** Newest first, numbered from 1. */
export function buildReportCatalog(
  sessions: ResearchSession[],
  store?: CatalogStore
): ReportEntry[] {
  return [...sessions]
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
    )
    .map((session, position) => toEntry(session, position + 1, store));
}

export interface CatalogFilter {
  text?: string;
  tag?: string;
}

/** Case-insensitive filter over id, title, goal, tags, top candidate, and preset; keeps indices. */
export function filterReportCatalog(entries: ReportEntry[], filter: CatalogFilter): ReportEntry[] {
  const text = filter.text?.trim().toLowerCase();
  const tag = filter.tag ? normalizeTag(filter.tag) : undefined;
  return entries.filter((entry) => {
    if (tag && !entry.tags.includes(tag)) return false;
    if (!text) return true;
    const haystack = [
      entry.id,
      entry.title,
      entry.goal,
      entry.tags.join(' '),
      entry.topCandidate ?? '',
      entry.preset ?? '',
      entry.summary ?? '',
    ]
      .join('\n')
      .toLowerCase();
    return haystack.includes(text);
  });
}

/** Resolve `2`, a full id, or a unique prefix or suffix of an id. */
export function resolveReportReference(entries: ReportEntry[], reference: string): ReportEntry {
  const ref = reference.trim();
  if (!ref) throw new Error('A report reference is required: a listing number or a session id');
  if (/^\d+$/.test(ref)) {
    const entry = entries.find((item) => item.index === Number(ref));
    if (!entry)
      throw new Error(`No report is listed as #${ref}; run /reports to see the numbering`);
    return entry;
  }
  const exact = entries.find((item) => item.id === ref);
  if (exact) return exact;
  const lower = ref.toLowerCase();
  const partial = entries.filter((item) => {
    const id = item.id.toLowerCase();
    return id.startsWith(lower) || id.endsWith(lower);
  });
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(
      `Ambiguous report reference "${ref}": ${partial.map((item) => item.id).join(', ')}`
    );
  }
  throw new Error(`No report matches "${ref}"; run /reports to list them`);
}

function whenText(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  return new Date(time).toISOString().slice(0, 16).replace('T', ' ');
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`;
}

export function reportsText(entries: ReportEntry[]): string {
  if (entries.length === 0) return 'No reports yet. Run /run to start a council session.';
  return table(
    ['#', 'ID', 'WHEN (UTC)', 'STATUS', 'TIME', 'CANDS', 'TITLE', 'TAGS'],
    entries.map((entry) => [
      String(entry.index),
      entry.id,
      whenText(entry.createdAt),
      entry.stageLabel,
      entry.elapsedMs === undefined ? '—' : formatDuration(entry.elapsedMs),
      String(entry.distinctCandidates),
      truncate(entry.title, 48),
      entry.tags.slice(0, 4).join(', '),
    ])
  ).join('\n');
}
