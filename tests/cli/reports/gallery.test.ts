import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { buildReportCatalog } from '../../../src/cli/reports/catalog.js';
import { renderReportsGallery, writeGallery } from '../../../src/cli/reports/gallery.js';
import { createTestStore, seedSession } from '../shell/fakes.js';

describe('reports gallery', () => {
  it('renders escaped cards with tag chips and report links', () => {
    const store = createTestStore();
    seedSession(store, { meta: { title: 'Drift <script>alert(1)</script>', tags: ['perf'] } });
    const html = renderReportsGallery(buildReportCatalog(store.list(), store), {
      generatedAt: '2026-09-04T12:00:00.000Z',
      home: store.root,
    });
    expect(html).toContain('href="./RC-20260827-000000Z-abc123/report.html"');
    expect(html).toContain('Drift &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('data-tag="perf"');
    expect(html).toContain('1 report · generated 2026-09-04 12:00 UTC');
    expect(html).not.toContain('duck-a');
  });

  it('writes index.html and renders missing HTML reports', () => {
    const store = createTestStore();
    seedSession(store);
    const path = writeGallery(store, buildReportCatalog(store.list(), store));
    expect(path).toBe(join(store.root, 'index.html'));
    expect(readFileSync(path, 'utf8')).toContain('Hypothesis Council reports');
    expect(
      existsSync(join(store.sessionDirectory('RC-20260827-000000Z-abc123'), 'report.html'))
    ).toBe(true);
  });
});
