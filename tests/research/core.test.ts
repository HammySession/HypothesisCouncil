import { assignReviewers } from '../../src/research/assignment.js';
import { deduplicateCandidates, measureConsensusCrowding } from '../../src/research/dedup.js';
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

function review(
  hypothesisId: string,
  score: number,
  fatal = false,
  killCriterion: HypothesisReview['killCriterion'] = 'concrete'
): HypothesisReview {
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
    killCriterion,
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

  it('gates untestable kill criteria below testable candidates but above fatal ones', () => {
    const candidates = [
      candidate('H-001', 'a', 'Eloquent but irrefutable', 'Claim one'),
      candidate('H-002', 'b', 'Modest but testable', 'Claim two'),
      candidate('H-003', 'c', 'Brilliant but fatally flawed', 'Claim three'),
    ];
    const ranked = rankCandidates(candidates, [
      review('H-001', 9, false, 'untestable'),
      review('H-002', 6),
      review('H-003', 10, true),
    ]);
    expect(ranked.find((item) => item.id === 'H-002')?.rank).toBe(1);
    expect(ranked.find((item) => item.id === 'H-001')?.rank).toBe(2);
    expect(ranked.find((item) => item.id === 'H-003')?.rank).toBe(3);
  });

  it('reviews persisted before kill-criterion grading never gate', () => {
    const candidates = [
      candidate('H-001', 'a', 'Pre-upgrade candidate', 'Claim one'),
      candidate('H-002', 'b', 'Post-upgrade candidate', 'Claim two'),
    ];
    const legacy = review('H-001', 8);
    delete legacy.killCriterion;
    const ranked = rankCandidates(candidates, [legacy, review('H-002', 7)]);
    expect(ranked.find((item) => item.id === 'H-001')?.rank).toBe(1);
  });

  it('measures cross-provider consensus crowding without counting self-agreement', () => {
    const crowding = measureConsensusCrowding([
      candidate(
        'H-001',
        'a',
        'Cache invalidation race',
        'A cache invalidation race causes stale reads'
      ),
      candidate(
        'H-002',
        'b',
        'Cache invalidation race window',
        'A cache invalidation race causes stale reads under load'
      ),
      candidate('H-003', 'a', 'Clock drift', 'Clock drift causes ordering failures'),
    ]);
    expect(crowding.clusters).toEqual([
      { candidateIds: ['H-001', 'H-002'], providerCount: 2 },
    ]);
    expect(crowding.crowdedCandidateIds).toEqual(['H-001', 'H-002']);
    expect(crowding.crowdingRatio).toBeCloseTo(2 / 3);

    const selfAgreement = measureConsensusCrowding([
      candidate('H-001', 'a', 'Cache invalidation race', 'A cache race causes stale reads'),
      candidate('H-002', 'a', 'Cache invalidation race', 'A cache race causes stale reads'),
    ]);
    expect(selfAgreement.clusters).toEqual([]);
    expect(selfAgreement.crowdingRatio).toBe(0);
  });
});
