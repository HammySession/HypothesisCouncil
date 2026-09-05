import { DEFAULT_DIAL_POLICY, type DialPolicy } from './dials.js';
import { lacksVerifiedContextEvidence } from './evidence.js';
import type { HypothesisCandidate, HypothesisReview, ScorePenalties } from './types.js';

export interface RankingOptions {
  /** Dial policy supplying weights, penalties, and gates; defaults to the 5/5 policy. */
  policy?: DialPolicy;
  /** Candidates flagged as consensus-crowded; penalised only when the policy says so. */
  crowdedCandidateIds?: readonly string[];
}

/**
 * Weighted mean of the six review dimensions. At the default dials every weight is 1, which is
 * the plain mean the council always used.
 */
export function reviewScore(
  review: HypothesisReview,
  policy: DialPolicy = DEFAULT_DIAL_POLICY
): number {
  const weights = policy.noveltyWeight + policy.robustnessWeight + 4;
  return (
    (review.plausibility +
      review.novelty * policy.noveltyWeight +
      review.testability +
      review.falsifiability +
      review.feasibility +
      review.robustness * policy.robustnessWeight) /
    weights
  );
}

export function rankCandidates(
  candidates: HypothesisCandidate[],
  reviews: HypothesisReview[],
  options: RankingOptions = {}
): HypothesisCandidate[] {
  const policy = options.policy ?? DEFAULT_DIAL_POLICY;
  const crowded = new Set(options.crowdedCandidateIds ?? []);
  const result = candidates.map((candidate) => ({ ...candidate }));
  const distinct = result.filter((candidate) => candidate.status === 'distinct');

  for (const candidate of distinct) {
    const candidateReviews = reviews.filter((review) => review.hypothesisId === candidate.id);
    const aggregate = candidateReviews.length
      ? candidateReviews.reduce((total, review) => total + reviewScore(review, policy), 0) /
        candidateReviews.length
      : 0;
    const penalties: ScorePenalties = {};
    if (crowded.has(candidate.id) && policy.crowdingPenalty > 0) {
      penalties.crowding = policy.crowdingPenalty;
    }
    if (
      policy.unsupportedEvidencePenalty > 0 &&
      lacksVerifiedContextEvidence(candidate.evidence, policy)
    ) {
      penalties.unsupportedEvidence = policy.unsupportedEvidencePenalty;
    }
    const deducted = (penalties.crowding ?? 0) + (penalties.unsupportedEvidence ?? 0);
    candidate.score = Math.max(0, aggregate - deducted);
    if (deducted > 0) candidate.scorePenalties = penalties;
    else delete candidate.scorePenalties;
  }

  // A fatal flaw gates hardest; an untestable declared falsifier gates below every testable
  // candidate, because a hypothesis nothing could refute must not win on eloquence; at high
  // skepticism a candidate with no verified context evidence gates below those that have some.
  // Reviews persisted before the kill-criterion assessment existed never gate.
  const gateLevel = (candidate: HypothesisCandidate): number => {
    const own = reviews.filter((review) => review.hypothesisId === candidate.id);
    if (own.some((review) => review.verdict === 'fatal' || Boolean(review.fatalFlaw))) return 3;
    if (own.some((review) => review.killCriterion === 'untestable')) return 2;
    if (policy.unverifiedFinalistGate && lacksVerifiedContextEvidence(candidate.evidence, policy)) {
      return 1;
    }
    return 0;
  };

  distinct.sort((left, right) => {
    return (
      gateLevel(left) - gateLevel(right) ||
      (right.score || 0) - (left.score || 0) ||
      left.id.localeCompare(right.id)
    );
  });

  distinct.forEach((candidate, index) => {
    candidate.rank = index + 1;
  });
  return result;
}

/** Human-readable description of how a policy turns reviews into ranks, for reports. */
export function explainRanking(policy: DialPolicy): string[] {
  const points = (value: number) => `${value.toFixed(2)} point${value === 1 ? '' : 's'}`;
  return [
    `Review aggregate: weighted mean of six review scores (novelty ×${policy.noveltyWeight.toFixed(2)}, robustness ×${policy.robustnessWeight.toFixed(2)}, others ×1.00)`,
    `Consensus crowding: similarity threshold ${policy.crowdingThreshold.toFixed(2)}; crowded candidates ${policy.crowdingPenalty > 0 ? `lose ${points(policy.crowdingPenalty)}` : 'are flagged but not penalised'}`,
    `Unsupported evidence: candidates without verified context evidence ${policy.unsupportedEvidencePenalty > 0 ? `lose ${points(policy.unsupportedEvidencePenalty)}` : 'are flagged but not penalised'}${policy.unverifiedFinalistGate ? ' and rank below candidates with verified evidence' : ''}${policy.discountWeakSources ? '; a source graded below 4 for reliability or contested does not count as verified' : ''}`,
    `Gates: fatal flaw, then untestable falsifier${policy.unverifiedFinalistGate ? ', then no verified context evidence' : ''}`,
  ];
}
