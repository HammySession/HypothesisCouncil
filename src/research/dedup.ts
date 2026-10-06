import type { ConsensusCrowding, HypothesisCandidate } from './types.js';

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

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
  );
}

/** Jaccard similarity of the content words in two texts, in [0, 1]. */
export function textSimilarity(left: string, right: string): number {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  const union = new Set([...leftTokens, ...rightTokens]);
  if (union.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / union.size;
}

function candidateText(candidate: HypothesisCandidate): string {
  return `${candidate.title} ${candidate.claim}`;
}

/**
 * Group items whose texts are at least `threshold` similar (transitively). Returns index groups,
 * each in ascending order and ordered by their first member, so the result does not depend on the
 * order pairs were compared in. `eligible` can veto a pair (for example same-author pairs).
 */
export function clusterBySimilarity<T>(
  items: T[],
  text: (item: T) => string,
  threshold: number,
  eligible: (left: T, right: T) => boolean = () => true
): number[][] {
  const parent = items.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const texts = items.map(text);
  for (let left = 0; left < items.length; left++) {
    for (let right = left + 1; right < items.length; right++) {
      if (!eligible(items[left], items[right])) continue;
      if (textSimilarity(texts[left], texts[right]) >= threshold) {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let index = 0; index < items.length; index++) {
    const root = find(index);
    groups.set(root, [...(groups.get(root) || []), index]);
  }
  return [...groups.values()]
    .map((group) => [...group].sort((left, right) => left - right))
    .sort((left, right) => left[0] - right[0]);
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

/**
 * Convergence detection uses a much lower similarity bar than deduplication: two hypotheses can be
 * the same idea in different words without being lexical duplicates. Only cross-provider pairs
 * count, because a provider repeating itself is not consensus.
 */
export const CONSENSUS_CROWDING_THRESHOLD = 0.45;

export function measureConsensusCrowding(
  candidates: HypothesisCandidate[],
  threshold = CONSENSUS_CROWDING_THRESHOLD
): ConsensusCrowding {
  const clusters = clusterBySimilarity(
    candidates,
    candidateText,
    threshold,
    (left, right) => left.authorProvider !== right.authorProvider
  )
    .filter((group) => group.length > 1)
    .map((group) => ({
      candidateIds: group.map((index) => candidates[index].id).sort(),
      providerCount: new Set(group.map((index) => candidates[index].authorProvider)).size,
    }))
    .sort((left, right) => left.candidateIds[0].localeCompare(right.candidateIds[0]));
  const crowdedCandidateIds = clusters.flatMap((cluster) => cluster.candidateIds).sort();
  return {
    similarityThreshold: threshold,
    clusters,
    crowdedCandidateIds,
    crowdingRatio: candidates.length === 0 ? 0 : crowdedCandidateIds.length / candidates.length,
  };
}

export function deduplicateCandidates(
  candidates: HypothesisCandidate[],
  threshold = 0.82
): HypothesisCandidate[] {
  const result = candidates.map((candidate) => ({ ...candidate }));
  for (const group of clusterBySimilarity(candidates, candidateText, threshold)) {
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
