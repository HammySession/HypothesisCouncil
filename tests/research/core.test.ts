import { assignReviewers } from '../../src/research/assignment.js';
import { deduplicateCandidates } from '../../src/research/dedup.js';
import { rankCandidates } from '../../src/research/ranking.js';
import type { HypothesisCandidate, HypothesisReview } from '../../src/research/types.js';

function candidate(
  id: string,
  authorProvider: string,
  title: string,
  claim: string
): HypothesisCandidate {
  return {
    id,
    sessionId: 'RC-test',
    generationIndex: 0,
    authorProvider,
    title,
    claim,
    mechanism: 'A concrete causal mechanism with measurable effects',
    predictions: ['A measurable prediction'],
    assumptions: ['An explicit assumption'],
    falsifier: 'A falsifying observation',
    minimalExperiment: 'A controlled experiment',
    confidence: 0.5,
    status: 'distinct',
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function review(hypothesisId: string, score: number, fatal = false): HypothesisReview {
  return {
    id: `RV-${hypothesisId}`,
    sessionId: 'RC-test',
    hypothesisId,
    reviewerProvider: 'reviewer',
    selfReview: false,
    plausibility: score,
    novelty: score,
    testability: score,
    falsifiability: score,
    feasibility: score,
    robustness: score,
    fatalFlaw: fatal ? 'Fatal circularity' : null,
    strongestObjection: 'Objection',
    hiddenAssumptions: [],
    proposedDiscriminatingTest: 'Test',
    verdict: fatal ? 'fatal' : 'accept',
    confidence: 0.8,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('research core algorithms', () => {
  it('deduplicates near-identical causal claims without discarding lineage', () => {
    const candidates = [
      candidate(
        'H-001',
        'a',
        'Cache invalidation race',
        'A cache invalidation race causes stale reads'
      ),
      candidate(
        'H-002',
        'b',
        'Cache invalidation race',
        'A cache invalidation race causes stale reads'
      ),
      candidate('H-003', 'c', 'Clock drift', 'Clock drift causes ordering failures'),
    ];

    const result = deduplicateCandidates(candidates);
    expect(result.filter((item) => item.status === 'distinct')).toHaveLength(2);
    expect(result.find((item) => item.status === 'duplicate')?.duplicateOf).toMatch(/^H-/);
  });

  it('assigns balanced non-author reviewers deterministically', () => {
    const candidates = [
      candidate('H-001', 'a', 'One', 'Claim one'),
      candidate('H-002', 'b', 'Two', 'Claim two'),
      candidate('H-003', 'c', 'Three', 'Claim three'),
    ];
    const first = assignReviewers(candidates, ['a', 'b', 'c'], 42);
    const second = assignReviewers(candidates, ['a', 'b', 'c'], 42);
    expect([...first]).toEqual([...second]);
    for (const item of candidates) expect(first.get(item.id)).not.toBe(item.authorProvider);
  });

  it('gates fatal flaws ahead of numeric review scores', () => {
    const candidates = [
      candidate('H-001', 'a', 'High but fatal', 'Claim one'),
      candidate('H-002', 'b', 'Lower but viable', 'Claim two'),
    ];
    const ranked = rankCandidates(candidates, [review('H-001', 10, true), review('H-002', 7)]);
    expect(ranked.find((item) => item.id === 'H-002')?.rank).toBe(1);
  });
});
