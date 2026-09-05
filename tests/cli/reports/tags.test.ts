import { deriveTags, normalizeTag, tokenizeWords } from '../../../src/cli/reports/tags.js';
import { createTestStore, seedSession } from '../shell/fakes.js';

describe('report tags', () => {
  it('keeps meaningful words only', () => {
    expect(tokenizeWords('Explain the drift in the Scheduler, H-002 and 2026')).toEqual([
      'drift',
      'scheduler',
    ]);
  });

  it('derives tags from the goal, title, and top candidates with user tags first', () => {
    const store = createTestStore();
    const session = seedSession(store, {
      meta: { title: 'Scheduler drift', tags: [' Perf ', 'perf'] },
    });
    expect(deriveTags(session)).toEqual(['perf', 'drift', 'scheduler', 'title']);
    expect(deriveTags(session, 2)).toEqual(['perf', 'drift']);
  });

  it('normalizes user tags', () => {
    expect(normalizeTag('  Race Condition ')).toBe('race-condition');
  });
});
