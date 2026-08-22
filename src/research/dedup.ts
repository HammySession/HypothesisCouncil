import type { HypothesisCandidate } from './types.js';

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'with',
]);

function tokens(candidate: HypothesisCandidate): Set<string> {
  return new Set(
    `${candidate.title} ${candidate.claim}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
  );
}

export function candidateSimilarity(left: HypothesisCandidate, right: HypothesisCandidate): number {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  const union = new Set([...leftTokens, ...rightTokens]);
  if (union.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / union.size;
}

function completeness(candidate: HypothesisCandidate): number {
  return (
    candidate.claim.length +
    candidate.mechanism.length +
    candidate.minimalExperiment.length +
    candidate.predictions.join(' ').length +
    candidate.assumptions.join(' ').length
  );
}

export function deduplicateCandidates(
  candidates: HypothesisCandidate[],
  threshold = 0.82
): HypothesisCandidate[] {
  const parent = candidates.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  for (let left = 0; left < candidates.length; left++) {
    for (let right = left + 1; right < candidates.length; right++) {
      if (candidateSimilarity(candidates[left], candidates[right]) >= threshold) {
        union(left, right);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let index = 0; index < candidates.length; index++) {
    const root = find(index);
    groups.set(root, [...(groups.get(root) || []), index]);
  }

  const result = candidates.map((candidate) => ({ ...candidate }));
  for (const group of groups.values()) {
    const representative = [...group].sort((left, right) => {
      const scoreDifference = completeness(candidates[right]) - completeness(candidates[left]);
      return scoreDifference || candidates[left].id.localeCompare(candidates[right].id);
    })[0];
    for (const index of group) {
      result[index].status = index === representative ? 'distinct' : 'duplicate';
      if (index !== representative) result[index].duplicateOf = candidates[representative].id;
    }
  }
  return result;
}
