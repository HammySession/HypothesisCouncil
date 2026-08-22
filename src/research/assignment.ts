import type { HypothesisCandidate } from './types.js';

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function assignReviewers(
  candidates: HypothesisCandidate[],
  providers: string[],
  seed: number
): Map<string, string> {
  const orderedProviders = [...providers].sort();
  const counts = new Map(orderedProviders.map((provider) => [provider, 0]));
  const result = new Map<string, string>();

  for (const candidate of [...candidates].sort((left, right) => left.id.localeCompare(right.id))) {
    const nonAuthors = orderedProviders.filter((provider) => provider !== candidate.authorProvider);
    const eligible = nonAuthors.length > 0 ? nonAuthors : orderedProviders;
    const offset = stableHash(`${seed}:${candidate.id}`) % Math.max(eligible.length, 1);
    const rotated = [...eligible.slice(offset), ...eligible.slice(0, offset)];
    const selected = rotated.sort((left, right) => {
      return (counts.get(left) || 0) - (counts.get(right) || 0);
    })[0];
    if (!selected) throw new Error('No provider available for review assignment');
    result.set(candidate.id, selected);
    counts.set(selected, (counts.get(selected) || 0) + 1);
  }
  return result;
}
