import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import type { ResearchSessionStore } from '../research/store.js';
import type { ResearchSession } from '../research/types.js';
import { renderHtmlReport } from './html-report.js';

/** Resolve `--out`: a trailing separator or an existing directory means "put the default name inside". */
export function resolveOutputPath(
  target: string,
  defaultName: string,
  cwd = process.cwd()
): string {
  const absolute = resolve(cwd, target);
  const isDirectory =
    /[\\/]$/.test(target) || (existsSync(absolute) && statSync(absolute).isDirectory());
  return isDirectory ? join(absolute, defaultName) : absolute;
}

function reportSource(session: ResearchSession, json: boolean): string {
  const source = json ? session.reportJsonPath : session.reportMarkdownPath;
  if (!source) throw new Error(`Report is not ready for ${session.id}`);
  return source;
}

export function copyReport(
  session: ResearchSession,
  target: string,
  json = false,
  cwd = process.cwd()
): string {
  const source = reportSource(session, json);
  const path = resolveOutputPath(target, `${session.id}.${json ? 'json' : 'md'}`, cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, readFileSync(source, 'utf8'));
  return path;
}

export function reportText(session: ResearchSession, json: boolean): string {
  return readFileSync(reportSource(session, json), 'utf8').trimEnd();
}

export function htmlReportTitle(session: ResearchSession): string {
  return `Hypothesis Council · ${session.id}`;
}

export function renderSessionHtml(session: ResearchSession): string {
  return renderHtmlReport(reportText(session, false), htmlReportTitle(session));
}

/** Write a freshly rendered HTML report to an explicit `--out` target. */
export function writeHtmlReport(
  session: ResearchSession,
  target: string,
  cwd = process.cwd()
): string {
  const path = resolveOutputPath(target, `${session.id}.html`, cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderSessionHtml(session));
  return path;
}

/**
 * Return the session's `report.html`, rendering it when it is missing or older than the Markdown
 * report it is derived from.
 */
export function ensureHtmlReport(store: ResearchSessionStore, session: ResearchSession): string {
  const markdownPath = reportSource(session, false);
  const htmlPath = join(store.sessionDirectory(session.id), 'report.html');
  if (existsSync(htmlPath) && existsSync(markdownPath)) {
    if (statSync(htmlPath).mtimeMs >= statSync(markdownPath).mtimeMs) return htmlPath;
  }
  return store.writeReport(session.id, 'report.html', renderSessionHtml(session));
}
