import type { ResearchSessionStore } from '../research/store.js';
import { flag, hasFlag, type ParsedArguments } from './arguments.js';
import type { CliDependencies } from './dependencies.js';
import { ensureHtmlReport } from './report-files.js';
import {
  buildReportCatalog,
  filterReportCatalog,
  reportsText,
  resolveReportReference,
  type ReportEntry,
} from './reports/catalog.js';
import { normalizeTag } from './reports/tags.js';
import { writeGallery } from './reports/gallery.js';

/** Shared by `hc reports`, `hc open`, `hc tag`, and their `/` counterparts. */

export function catalogFor(store: ResearchSessionStore): ReportEntry[] {
  return buildReportCatalog(store.list(), store);
}

export interface ReportsListing {
  entries: ReportEntry[];
  text: string;
  galleryPath?: string;
}

export function listReports(
  store: ResearchSessionStore,
  deps: Pick<CliDependencies, 'io' | 'openInBrowser' | 'now'>,
  options: { filter?: string; tag?: string; json?: boolean; html?: boolean; open?: boolean }
): ReportsListing {
  const entries = filterReportCatalog(catalogFor(store), {
    text: options.filter,
    tag: options.tag,
  });
  let galleryPath: string | undefined;
  if (options.html || options.open) {
    galleryPath = writeGallery(store, entries, new Date(deps.now()).toISOString());
    if (options.open) deps.openInBrowser(galleryPath);
  }
  const text = options.json ? JSON.stringify(entries, null, 2) : reportsText(entries);
  return { entries, text, galleryPath };
}

export function executeReports(
  parsed: ParsedArguments,
  store: ResearchSessionStore,
  deps: Pick<CliDependencies, 'io' | 'openInBrowser' | 'now'>
): number {
  const listing = listReports(store, deps, {
    filter: flag(parsed, '--filter') ?? (parsed.positionals.join(' ') || undefined),
    tag: flag(parsed, '--tag'),
    json: hasFlag(parsed, '--json'),
    html: hasFlag(parsed, '--html'),
    open: hasFlag(parsed, '--open'),
  });
  deps.io.out(listing.text);
  if (listing.galleryPath) deps.io.out(`Gallery: ${listing.galleryPath}`);
  return 0;
}

/** Open `index` (the gallery) or one report by listing number or id in the browser. */
export function openReport(
  reference: string,
  store: ResearchSessionStore,
  deps: Pick<CliDependencies, 'io' | 'openInBrowser' | 'now'>,
  listing: ReportEntry[] = catalogFor(store)
): string {
  if (reference === 'index' || reference === 'gallery') {
    const path = writeGallery(store, catalogFor(store), new Date(deps.now()).toISOString());
    deps.openInBrowser(path);
    deps.io.out(`Gallery: ${path}`);
    return path;
  }
  const entry = resolveReportReference(listing, reference);
  const session = store.load(entry.id);
  if (!session.reportMarkdownPath) {
    throw new Error(`Session ${entry.id} has no report yet (${entry.stageLabel})`);
  }
  const path = ensureHtmlReport(store, session);
  deps.openInBrowser(path);
  deps.io.out(`HTML report: ${path}`);
  return path;
}

export const TAG_USAGE =
  'Usage: tag [SESSION] add TAG[,TAG] | rm TAG[,TAG] | title TEXT | clear | show';

function splitTags(words: string[]): string[] {
  return [
    ...new Set(
      words
        .join(' ')
        .split(/[,\s]+/)
        .map(normalizeTag)
        .filter(Boolean)
    ),
  ];
}

/** Apply a tag or title edit; `words` are the arguments after the optional session id. */
export function editTags(
  sessionId: string,
  words: string[],
  store: ResearchSessionStore,
  io: CliDependencies['io']
): void {
  const [verb, ...rest] = words;
  const session = store.load(sessionId);
  const current = session.meta?.tags ?? [];
  switch (verb) {
    case undefined:
    case 'show': {
      io.out(`${session.id}: ${session.meta?.title ?? session.goal}`);
      io.out(`Tags: ${current.length > 0 ? current.join(', ') : '(none)'}`);
      return;
    }
    case 'add': {
      const tags = splitTags(rest);
      if (tags.length === 0) throw new Error(TAG_USAGE);
      const updated = store.updateMeta(session.id, { tags: [...current, ...tags] });
      io.out(`Tags for ${session.id}: ${updated.meta?.tags?.join(', ')}`);
      return;
    }
    case 'rm':
    case 'remove': {
      const tags = splitTags(rest);
      if (tags.length === 0) throw new Error(TAG_USAGE);
      const remaining = current.filter((tag) => !tags.includes(tag));
      const updated = store.updateMeta(session.id, { tags: remaining });
      io.out(`Tags for ${session.id}: ${updated.meta?.tags?.join(', ') || '(none)'}`);
      return;
    }
    case 'clear': {
      store.updateMeta(session.id, { tags: [] });
      io.out(`Tags for ${session.id}: (none)`);
      return;
    }
    case 'title': {
      const title = rest.join(' ').trim();
      if (!title) throw new Error(TAG_USAGE);
      store.updateMeta(session.id, { title });
      io.out(`Title for ${session.id}: ${title}`);
      return;
    }
    default:
      throw new Error(`${TAG_USAGE}\nUnknown verb: ${verb}`);
  }
}

/** `hc tag [SESSION] …`; the session defaults to the current one. */
export function executeTag(
  words: string[],
  store: ResearchSessionStore,
  io: CliDependencies['io'],
  fallbackSession?: string
): number {
  const explicit = words[0]?.startsWith('RC-') ? words[0] : undefined;
  const sessionId = explicit ?? fallbackSession ?? store.currentId();
  if (!sessionId) throw new Error(`${TAG_USAGE}\nNo session is selected.`);
  editTags(sessionId, explicit ? words.slice(1) : words, store, io);
  return 0;
}
