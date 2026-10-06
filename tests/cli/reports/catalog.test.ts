import {
  buildReportCatalog,
  filterReportCatalog,
  reportsText,
  resolveReportReference,
  sessionElapsedMs,
} from '../../../src/cli/reports/catalog.js';
import type { ResearchSession } from '../../../src/research/types.js';
import { createTestStore, seedSession } from '../shell/fakes.js';

const NEWER = 'RC-20260901-000000Z-def456';
const OLDER = 'RC-20260827-000000Z-abc123';

function call(startedAt: string, endedAt: string): ResearchSession['calls'][number] {
  return { startedAt, endedAt } as unknown as ResearchSession['calls'][number];
}

function seedTwo() {
  const store = createTestStore();
  seedSession(store);
  seedSession(store, {
    id: NEWER,
    goal: 'Find the memory leak',
    createdAt: '2026-09-01T00:00:00.000Z',
    calls: [
      call('2026-09-01T00:00:10.000Z', '2026-09-01T00:01:00.000Z'),
      call('2026-09-01T00:00:30.000Z', '2026-09-01T00:02:40.000Z'),
    ],
    meta: { title: 'Leak hunt', tags: ['perf'], preset: 'frontier' },
  });
  return store;
}

describe('report catalog', () => {
  it('lists sessions newest first with labels, counts, and tags but no provider identities', () => {
    const store = seedTwo();
    const entries = buildReportCatalog(store.list(), store);
    expect(entries.map((entry) => [entry.index, entry.id])).toEqual([
      [1, NEWER],
      [2, OLDER],
    ]);
    expect(entries[0]).toMatchObject({
      title: 'Leak hunt',
      goal: 'Find the memory leak',
      userTags: ['perf'],
      tags: ['perf', 'leak', 'find', 'hunt', 'memory', 'title'],
      elapsedMs: 150_000,
      distinctCandidates: 2,
      topCandidate: 'H-002 Title H-002',
      preset: 'frontier',
      stageLabel: 'COMPLETE',
      providerCount: 2,
    });
    expect(entries[1].elapsedMs).toBeUndefined();
    expect(entries[1].htmlPath).toBeUndefined();
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain('duck-a');
    expect(serialized).not.toContain('duck-b');
    expect(serialized).not.toContain('authorProvider');
  });

  it('measures elapsed time from provider calls when they exist', () => {
    const store = createTestStore();
    const session = seedSession(store, {
      calls: [call('2026-08-27T00:00:10.000Z', '2026-08-27T00:01:40.000Z')],
    });
    expect(sessionElapsedMs(session)).toBe(90_000);
    expect(sessionElapsedMs({ ...session, calls: [] })).toBeUndefined();
  });

  it('filters by text and tag while keeping listing numbers', () => {
    const store = seedTwo();
    const entries = buildReportCatalog(store.list(), store);
    expect(filterReportCatalog(entries, { text: 'LEAK' }).map((entry) => entry.index)).toEqual([1]);
    expect(filterReportCatalog(entries, { tag: 'drift' }).map((entry) => entry.index)).toEqual([2]);
    expect(filterReportCatalog(entries, { tag: 'Perf', text: 'drift' })).toEqual([]);
  });

  it('resolves listing numbers, ids, and unique fragments', () => {
    const store = seedTwo();
    const entries = buildReportCatalog(store.list(), store);
    expect(resolveReportReference(entries, '2').id).toBe(OLDER);
    expect(resolveReportReference(entries, NEWER).id).toBe(NEWER);
    expect(resolveReportReference(entries, 'abc123').id).toBe(OLDER);
    expect(() => resolveReportReference(entries, 'RC-2026')).toThrow('Ambiguous report reference');
    expect(() => resolveReportReference(entries, '9')).toThrow('No report is listed as #9');
    expect(() => resolveReportReference(entries, 'zzz')).toThrow('No report matches "zzz"');
  });

  it('renders a table with elapsed time and tags', () => {
    const store = seedTwo();
    const text = reportsText(buildReportCatalog(store.list(), store));
    expect(text).toMatch(/#\s+ID\s+WHEN \(UTC\)\s+STATUS\s+TIME\s+CANDS\s+TITLE\s+TAGS/);
    expect(text).toMatch(
      /1\s+RC-20260901-000000Z-def456\s+2026-09-01 00:00\s+COMPLETE\s+2m 30s\s+2\s+Leak hunt/
    );
    expect(text).toContain('perf, leak, find, hunt');
    expect(text).toMatch(
      /2\s+RC-20260827-000000Z-abc123\s+2026-08-27 00:00\s+COMPLETE\s+-\s+2\s+Explain the drift/
    );
    expect(reportsText([])).toContain('No reports yet');
  });
});
