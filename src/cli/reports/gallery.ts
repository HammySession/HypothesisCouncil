import { writeFileSync } from 'fs';
import { join } from 'path';
import type { ResearchSessionStore } from '../../research/store.js';
import { formatDuration } from '../format.js';
import { escapeHtml } from '../html-report.js';
import { ensureHtmlReport } from '../report-files.js';
import type { ReportEntry } from './catalog.js';

/**
 * A self-contained HTML index of every report: tag chips, a text filter, and one link per entry
 * to `./<id>/report.html`. Entries carry labels only, so nothing here can leak an author.
 */

export interface GalleryOptions {
  generatedAt: string;
  home: string;
}

function whenText(iso: string): string {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 16).replace('T', ' ') : iso;
}

function card(entry: ReportEntry): string {
  const tags = entry.tags
    .map(
      (tag) =>
        `<button class="tag" type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
    )
    .join(' ');
  const facts = [
    whenText(entry.createdAt),
    entry.stageLabel,
    entry.elapsedMs === undefined ? '' : formatDuration(entry.elapsedMs),
    `${entry.distinctCandidates} candidate${entry.distinctCandidates === 1 ? '' : 's'}`,
    entry.preset ? `preset ${entry.preset}` : '',
  ].filter(Boolean);
  const search = escapeHtml(
    [entry.id, entry.title, entry.goal, entry.tags.join(' '), entry.summary ?? ''].join(' ')
  );
  return `<article class="card" data-search="${search}" data-tags="${escapeHtml(entry.tags.join(' '))}">
  <h2><a href="./${encodeURIComponent(entry.id)}/report.html">${escapeHtml(entry.title)}</a></h2>
  <p class="facts">${facts.map(escapeHtml).join(' · ')}</p>
  ${entry.title !== entry.goal ? `<p class="goal">${escapeHtml(entry.goal)}</p>` : ''}
  ${entry.summary ? `<p class="summary">${escapeHtml(entry.summary)}</p>` : ''}
  ${entry.topCandidate ? `<p class="top">Top candidate: ${escapeHtml(entry.topCandidate)}</p>` : ''}
  <p class="tags">${tags}</p>
  <p class="id"><code>${escapeHtml(entry.id)}</code></p>
</article>`;
}

export function renderReportsGallery(entries: ReportEntry[], options: GalleryOptions): string {
  const cards = entries.map(card).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hypothesis Council reports</title>
<style>
  :root { color-scheme: light dark; --line: #d5d9e0; --muted: #5d6675; --chip: rgba(138, 147, 163, 0.16); }
  body { margin: 0 auto; padding: 2rem 1.5rem 4rem; max-width: 60rem; font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; background: #fdfdfc; color: #1e2126; }
  header { display: flex; flex-wrap: wrap; gap: 0.75rem 1.5rem; align-items: baseline; border-bottom: 2px solid var(--line); padding-bottom: 0.75rem; margin-bottom: 1.25rem; }
  header h1 { margin: 0; font-size: 1.5rem; }
  header p { margin: 0; color: var(--muted); }
  #filter { flex: 1 1 16rem; padding: 0.4rem 0.6rem; font: inherit; border: 1px solid var(--line); border-radius: 4px; background: transparent; color: inherit; }
  .card { border: 1px solid var(--line); border-radius: 6px; padding: 0.9rem 1.1rem; margin: 0.8rem 0; }
  .card h2 { margin: 0 0 0.3rem; font-size: 1.1rem; }
  .card p { margin: 0.25rem 0; }
  .facts, .id { color: var(--muted); font-size: 0.9rem; }
  .tag { font: inherit; font-size: 0.8rem; border: none; border-radius: 999px; padding: 0.1rem 0.6rem; background: var(--chip); color: inherit; cursor: pointer; }
  .tag.active { outline: 2px solid #8a93a3; }
  .hidden { display: none; }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 0.9em; }
  @media (prefers-color-scheme: dark) { body { background: #16181d; color: #d8dbe1; } :root { --line: #3a3f4a; --muted: #9aa3b2; } }
</style>
</head>
<body>
<header>
  <h1>Hypothesis Council reports</h1>
  <p>${entries.length} report${entries.length === 1 ? '' : 's'} · generated ${escapeHtml(whenText(options.generatedAt))} UTC · ${escapeHtml(options.home)}</p>
  <input id="filter" type="search" placeholder="Filter by text or tag" aria-label="Filter reports">
</header>
<main id="cards">
${cards || '<p>No reports yet.</p>'}
</main>
<script>
(function () {
  var input = document.getElementById('filter');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  var activeTag = '';
  function apply() {
    var text = input.value.trim().toLowerCase();
    cards.forEach(function (card) {
      var tags = (card.getAttribute('data-tags') || '').split(' ');
      var visible = (!activeTag || tags.indexOf(activeTag) !== -1) &&
        (!text || (card.getAttribute('data-search') || '').toLowerCase().indexOf(text) !== -1);
      card.classList.toggle('hidden', !visible);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tag'), function (chip) {
      chip.classList.toggle('active', !!activeTag && chip.getAttribute('data-tag') === activeTag);
    });
  }
  input.addEventListener('input', apply);
  document.addEventListener('click', function (event) {
    var chip = event.target.closest ? event.target.closest('.tag') : null;
    if (!chip) return;
    var tag = chip.getAttribute('data-tag') || '';
    activeTag = activeTag === tag ? '' : tag;
    apply();
  });
})();
</script>
</body>
</html>
`;
}

/** Render every entry's HTML report when missing or stale, then write `<home>/index.html`. */
export function writeGallery(
  store: ResearchSessionStore,
  entries: ReportEntry[],
  generatedAt = new Date().toISOString()
): string {
  for (const entry of entries) {
    if (!entry.reportMarkdownPath) continue;
    ensureHtmlReport(store, store.load(entry.id));
  }
  const path = join(store.root, 'index.html');
  writeFileSync(path, renderReportsGallery(entries, { generatedAt, home: store.root }), {
    encoding: 'utf8',
    mode: 0o600,
  });
  return path;
}
