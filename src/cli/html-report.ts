import { spawn } from 'child_process';

/**
 * Renders the council's Markdown report as a self-contained HTML document. The converter covers
 * exactly the constructs `renderMarkdownReport` emits (headings, paragraphs, blockquotes, dash
 * lists, horizontal rules, `**bold**`, and backtick code); unknown lines degrade to paragraphs.
 * All report text is HTML-escaped, so hypothesis content can never inject markup.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function markdownToHtml(markdown: string): string {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${paragraph.map(renderInline).join(' ')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(`<ul>\n${listItems.join('\n')}\n</ul>`);
    listItems = [];
  };

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push(`<h${heading[1].length}>${renderInline(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    if (/^-{3,}$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push('<hr>');
      continue;
    }
    if (trimmed.startsWith('> ')) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${renderInline(trimmed.slice(2))}</blockquote>`);
      continue;
    }
    if (trimmed.startsWith('- ')) {
      flushParagraph();
      listItems.push(`<li>${renderInline(trimmed.slice(2))}</li>`);
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return blocks.join('\n');
}

export function renderHtmlReport(markdown: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0 auto;
    padding: 2.5rem 1.5rem 4rem;
    max-width: 46rem;
    font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #fdfdfc;
    color: #1e2126;
  }
  h1 { font-size: 1.7rem; border-bottom: 2px solid #d5d9e0; padding-bottom: 0.4rem; }
  h2 { font-size: 1.25rem; margin-top: 2.2rem; }
  h3 { font-size: 1.05rem; margin-top: 1.8rem; }
  blockquote {
    margin: 1rem 0;
    padding: 0.6rem 1rem;
    border-left: 4px solid #8a93a3;
    background: rgba(138, 147, 163, 0.12);
  }
  hr { border: none; border-top: 1px solid #d5d9e0; margin: 1.6rem 0; }
  code {
    font-family: ui-monospace, Consolas, monospace;
    font-size: 0.9em;
    background: rgba(138, 147, 163, 0.16);
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }
  ul { padding-left: 1.4rem; }
  li { margin: 0.25rem 0; }
  @media (prefers-color-scheme: dark) {
    body { background: #16181d; color: #d8dbe1; }
    h1, hr { border-color: #3a3f4a; }
  }
</style>
</head>
<body>
${markdownToHtml(markdown)}
</body>
</html>
`;
}

export interface BrowserLaunch {
  command: string;
  args: string[];
}

export function browserCommand(
  path: string,
  platform: NodeJS.Platform = process.platform
): BrowserLaunch {
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', path] };
  if (platform === 'darwin') return { command: 'open', args: [path] };
  return { command: 'xdg-open', args: [path] };
}

export function openInBrowser(
  path: string,
  options: { platform?: NodeJS.Platform; spawner?: typeof spawn } = {}
): void {
  const { command, args } = browserCommand(path, options.platform);
  const spawner = options.spawner ?? spawn;
  const child = spawner(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
  child.unref();
}
