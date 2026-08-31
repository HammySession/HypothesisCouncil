import { jest } from '@jest/globals';
import type { spawn } from 'child_process';
import {
  browserCommand,
  markdownToHtml,
  openInBrowser,
  renderHtmlReport,
} from '../../src/cli/html-report.js';

describe('markdownToHtml', () => {
  it('renders the report subset: headings, bold, lists, quotes, and rules', () => {
    const html = markdownToHtml(
      [
        '# Hypothesis Council Report',
        '',
        '> Rankings summarize review signals.',
        '',
        '### 1. H-001 — Title',
        '',
        '**Claim:** water flows downhill',
        '',
        '- duck warning one',
        '- duck warning two',
        '',
        '---',
      ].join('\n')
    );

    expect(html).toContain('<h1>Hypothesis Council Report</h1>');
    expect(html).toContain('<blockquote>Rankings summarize review signals.</blockquote>');
    expect(html).toContain('<h3>1. H-001 — Title</h3>');
    expect(html).toContain('<p><strong>Claim:</strong> water flows downhill</p>');
    expect(html).toContain('<li>duck warning one</li>');
    expect(html).toContain('<li>duck warning two</li>');
    expect(html).toContain('<hr>');
  });

  it('escapes hypothesis content so provider output cannot inject markup', () => {
    const html = markdownToHtml('**Claim:** use <script>alert(1)</script> & "quotes"');

    expect(html).not.toContain('<script>');
    expect(html).toContain(
      '<p><strong>Claim:</strong> use &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;</p>'
    );
  });
});

describe('renderHtmlReport', () => {
  it('produces a standalone document with an escaped title', () => {
    const html = renderHtmlReport('# Body', 'RC-1 <session>');

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>RC-1 &lt;session&gt;</title>');
    expect(html).toContain('<h1>Body</h1>');
    expect(html).toContain('prefers-color-scheme: dark');
  });
});

describe('openInBrowser', () => {
  it('builds the launch command for each platform', () => {
    expect(browserCommand('C:\\r\\report.html', 'win32')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', 'C:\\r\\report.html'],
    });
    expect(browserCommand('/r/report.html', 'darwin')).toEqual({
      command: 'open',
      args: ['/r/report.html'],
    });
    expect(browserCommand('/r/report.html', 'linux')).toEqual({
      command: 'xdg-open',
      args: ['/r/report.html'],
    });
  });

  it('spawns the browser detached without inheriting stdio', () => {
    const unref = jest.fn();
    const spawner = jest.fn(() => ({ unref })) as unknown as typeof spawn;

    openInBrowser('/tmp/report.html', { platform: 'linux', spawner });

    expect(spawner).toHaveBeenCalledWith('xdg-open', ['/tmp/report.html'], {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    expect(unref).toHaveBeenCalled();
  });
});
