import type { HypothesisCandidate, HypothesisReview } from './types.js';

function reviewScore(review: HypothesisReview): number {
  return (
    (review.plausibility +
      review.novelty +
      review.testability +
      review.falsifiability +
      review.feasibility +
      review.robustness) /
    6
  );
}

export function rankCandidates(
  candidates: HypothesisCandidate[],
  reviews: HypothesisReview[]
): HypothesisCandidate[] {
  const result = candidates.map((candidate) => ({ ...candidate }));
  const distinct = result.filter((candidate) => candidate.status === 'distinct');

  for (const candidate of distinct) {
    const candidateReviews = reviews.filter((review) => review.hypothesisId === candidate.id);
    candidate.score = candidateReviews.length
      ? candidateReviews.reduce((total, review) => total + reviewScore(review), 0) /
        candidateReviews.length
      : 0;
  }

  // A fatal flaw gates hardest; an untestable declared falsifier gates below every testable
  // candidate, because a hypothesis nothing could refute must not win on eloquence. Reviews
  // persisted before the kill-criterion assessment existed never gate.
  const gateLevel = (candidateId: string): number => {
    const own = reviews.filter((review) => review.hypothesisId === candidateId);
    if (own.some((review) => review.verdict === 'fatal' || Boolean(review.fatalFlaw))) return 2;
    if (own.some((review) => review.killCriterion === 'untestable')) return 1;
    return 0;
  };

  distinct.sort((left, right) => {
    return (
      gateLevel(left.id) - gateLevel(right.id) ||
      (right.score || 0) - (left.score || 0) ||
      left.id.localeCompare(right.id)
    );
  });

  distinct.forEach((candidate, index) => {
    candidate.rank = index + 1;
  });
  return result;
}
