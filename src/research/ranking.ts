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

  distinct.sort((left, right) => {
    const leftFatal = reviews.some(
      (review) =>
        review.hypothesisId === left.id && (review.verdict === 'fatal' || Boolean(review.fatalFlaw))
    );
    const rightFatal = reviews.some(
      (review) =>
        review.hypothesisId === right.id &&
        (review.verdict === 'fatal' || Boolean(review.fatalFlaw))
    );
    return (
      Number(leftFatal) - Number(rightFatal) ||
      (right.score || 0) - (left.score || 0) ||
      left.id.localeCompare(right.id)
    );
  });

  distinct.forEach((candidate, index) => {
    candidate.rank = index + 1;
  });
  return result;
}
