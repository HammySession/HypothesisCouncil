import { assignReviewers } from '../../src/research/assignment.js';
import {
  clusterBySimilarity,
  deduplicateCandidates,
  measureConsensusCrowding,
  textSimilarity,
} from '../../src/research/dedup.js';
import { resolveDialPolicy } from '../../src/research/dials.js';
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

  it('prefers a fresh non-author when earlier attackers are excluded', () => {
    const candidates = [candidate('H-001', 'a', 'One', 'Claim one')];
    const exclude = new Map([['H-001', ['b']]]);
    expect(assignReviewers(candidates, ['a', 'b', 'c'], 1, { exclude }).get('H-001')).toBe('c');
    // With only the author left unexcluded, the author attacks rather than nobody.
    expect(assignReviewers(candidates, ['a', 'b'], 1, { exclude }).get('H-001')).toBe('a');
    // When everyone is excluded, fall back to the ordinary non-author pool.
    const all = new Map([['H-001', ['a', 'b']]]);
    expect(assignReviewers(candidates, ['a', 'b'], 1, { exclude: all }).get('H-001')).toBe('b');
  });

  it('keeps default ranking unchanged at dial level 5/5 and ignores crowding there', () => {
    const build = () => [
      candidate('H-001', 'a', 'One', 'Claim one'),
      candidate('H-002', 'b', 'Two', 'Claim two'),
    ];
    const reviews = [review('H-001', 8), review('H-002', 7)];
    const plain = rankCandidates(build(), reviews);
    const dialed = rankCandidates(build(), reviews, {
      policy: resolveDialPolicy({ novelty: 5, skepticism: 5 }),
      crowdedCandidateIds: ['H-001'],
    });
    const summary = (items: HypothesisCandidate[]) =>
      items.map((item) => [item.id, item.rank, item.score]);
    expect(summary(dialed)).toEqual(summary(plain));
    expect(dialed.every((item) => item.scorePenalties === undefined)).toBe(true);
    expect(plain.find((item) => item.id === 'H-001')?.score).toBe(8);
  });

  it('penalises consensus-crowded candidates at high novelty', () => {
    const ranked = rankCandidates(
      [
        candidate('H-001', 'a', 'Crowded', 'Claim one'),
        candidate('H-002', 'b', 'Lonely', 'Claim two'),
      ],
      [review('H-001', 7), review('H-002', 7)],
      { policy: resolveDialPolicy({ novelty: 10 }), crowdedCandidateIds: ['H-001'] }
    );
    const crowded = ranked.find((item) => item.id === 'H-001');
    expect(crowded?.rank).toBe(2);
    expect(crowded?.scorePenalties).toEqual({ crowding: 1.5 });
    expect(crowded?.score).toBe(5.5);
    expect(ranked.find((item) => item.id === 'H-002')?.rank).toBe(1);
  });

  it('penalises and gates unverified evidence at high skepticism', () => {
    const build = () => {
      const grounded = candidate('H-001', 'a', 'Grounded', 'Claim one');
      grounded.evidence = [
        { claim: 'quoted', basis: 'context', contextQuote: 'q', verification: 'verified' },
      ];
      const remembered = candidate('H-002', 'b', 'Remembered', 'Claim two');
      remembered.evidence = [
        { claim: 'recalled', basis: 'general-knowledge', verification: 'not-applicable' },
      ];
      return [grounded, remembered];
    };
    const reviews = [review('H-001', 6), review('H-002', 9)];

    const strict = rankCandidates(build(), reviews, {
      policy: resolveDialPolicy({ skepticism: 10 }),
    });
    expect(strict.find((item) => item.id === 'H-001')?.rank).toBe(1);
    const weak = strict.find((item) => item.id === 'H-002');
    expect(weak?.rank).toBe(2);
    expect(weak?.scorePenalties).toEqual({ unsupportedEvidence: 1 });
    expect(weak?.score).toBe(8);

    const moderate = rankCandidates(build(), reviews, {
      policy: resolveDialPolicy({ skepticism: 7 }),
    });
    expect(moderate.find((item) => item.id === 'H-002')?.rank).toBe(1);
    expect(moderate.find((item) => item.id === 'H-002')?.score).toBeCloseTo(8.6);
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
    expect(crowding.clusters).toEqual([{ candidateIds: ['H-001', 'H-002'], providerCount: 2 }]);
    expect(crowding.crowdedCandidateIds).toEqual(['H-001', 'H-002']);
    expect(crowding.crowdingRatio).toBeCloseTo(2 / 3);

    const selfAgreement = measureConsensusCrowding([
      candidate('H-001', 'a', 'Cache invalidation race', 'A cache race causes stale reads'),
      candidate('H-002', 'a', 'Cache invalidation race', 'A cache race causes stale reads'),
    ]);
    expect(selfAgreement.clusters).toEqual([]);
    expect(selfAgreement.crowdingRatio).toBe(0);
  });

  it('measures text similarity on content words and clusters order-independently', () => {
    expect(textSimilarity('The cache is stale', 'A stale cache')).toBe(1);
    expect(textSimilarity('', 'anything')).toBe(0);
    expect(textSimilarity('alpha beta gamma', 'alpha delta')).toBeCloseTo(1 / 4);

    const items = [
      { key: 'x', text: 'clock drift reverses event ordering' },
      { key: 'y', text: 'stale cache reads after eviction' },
      { key: 'z', text: 'clock drift reverses ordering' },
      { key: 'w', text: 'unrelated network partition' },
    ];
    const forward = clusterBySimilarity(items, (item) => item.text, 0.6);
    const reversed = clusterBySimilarity([...items].reverse(), (item) => item.text, 0.6).map(
      (group) => group.map((index) => items.length - 1 - index).sort((a, b) => a - b)
    );
    expect(forward).toEqual([[0, 2], [1], [3]]);
    expect([...reversed].sort((a, b) => a[0] - b[0])).toEqual(forward);
    expect(
      clusterBySimilarity(
        items,
        (item) => item.text,
        0.6,
        (left, right) => left.key !== 'x' && right.key !== 'x'
      )
    ).toEqual([[0], [1], [2], [3]]);
  });
});
