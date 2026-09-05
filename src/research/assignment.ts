/** FNV-1a 32-bit hash; stable across runs so assignments are reproducible from a seed. */
export function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface Authored {
  id: string;
  authorProvider: string;
}

export interface AssignmentOptions {
  /**
   * Providers that must not be assigned to a given item id when any alternative exists, for
   * example the attacker from an earlier falsification round.
   */
  exclude?: ReadonlyMap<string, readonly string[]>;
}

/**
 * Give every item a reviewer that is not its author, balancing load across providers. The seed
 * rotates the starting provider per item so the same council reviews differently across runs.
 * Excluded providers are avoided before authorship is: a second round prefers a fresh attacker,
 * even the author, over repeating the first one.
 */
export function assignReviewers<T extends Authored>(
  candidates: T[],
  providers: string[],
  seed: number,
  options: AssignmentOptions = {}
): Map<string, string> {
  const orderedProviders = [...providers].sort();
  const counts = new Map(orderedProviders.map((provider) => [provider, 0]));
  const result = new Map<string, string>();

  for (const candidate of [...candidates].sort((left, right) => left.id.localeCompare(right.id))) {
    const excluded = new Set(options.exclude?.get(candidate.id) ?? []);
    const notExcluded = orderedProviders.filter((provider) => !excluded.has(provider));
    const nonAuthors = orderedProviders.filter((provider) => provider !== candidate.authorProvider);
    const eligible =
      [
        notExcluded.filter((provider) => provider !== candidate.authorProvider),
        notExcluded,
        nonAuthors,
        orderedProviders,
      ].find((pool) => pool.length > 0) ?? [];
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
