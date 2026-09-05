import type { ProviderSelection } from './context.js';

/** The little a mention needs to know about a provider. */
export interface ProviderName {
  name: string;
  nickname?: string;
  type?: string;
}

/** Match a mention by exact name, nickname, `cli-` stripped name, or unique prefix. */
export function resolveMention(
  token: string,
  providers: readonly ProviderName[]
): string | undefined {
  const wanted = token.trim().toLowerCase();
  if (!wanted) return undefined;
  const exact = providers.find((provider) => provider.name.toLowerCase() === wanted);
  if (exact) return exact.name;
  const byNickname = providers.find((provider) => provider.nickname?.toLowerCase() === wanted);
  if (byNickname) return byNickname.name;
  const stripped = providers.filter(
    (provider) => provider.name.toLowerCase().replace(/^cli-/, '') === wanted
  );
  if (stripped.length === 1) return stripped[0].name;
  const prefixed = providers.filter((provider) => {
    const name = provider.name.toLowerCase();
    return name.startsWith(wanted) || name.replace(/^cli-/, '').startsWith(wanted);
  });
  return prefixed.length === 1 ? prefixed[0].name : undefined;
}

export interface Mentions {
  providers: string[];
  paths: string[];
  /** The line with the mentions removed. */
  text: string;
}

/**
 * Pull `@tokens` out of a chat line. A token that names a provider selects it for this message;
 * anything else is a path for the context basket. Provider mentions win over path mentions.
 */
export function splitMentions(line: string, providers: readonly ProviderName[]): Mentions {
  const mentioned: string[] = [];
  const paths: string[] = [];
  const words: string[] = [];
  for (const word of line.split(/\s+/)) {
    if (!word) continue;
    if (word.startsWith('@') && word.length > 1) {
      const token = word.slice(1).replace(/[,;:]+$/, '');
      const provider = resolveMention(token, providers);
      if (provider) {
        if (!mentioned.includes(provider)) mentioned.push(provider);
      } else if (!paths.includes(token)) {
        paths.push(token);
      }
      continue;
    }
    words.push(word);
  }
  return { providers: mentioned, paths, text: words.join(' ').trim() };
}

/** Parse `/duck` arguments: `all`, `auto`, or names separated by commas or spaces. */
export function parseSelection(
  args: string,
  providers: readonly ProviderName[]
): ProviderSelection {
  const trimmed = args.trim();
  if (!trimmed || trimmed === 'auto') return { kind: 'auto' };
  if (trimmed === 'all') return { kind: 'all' };
  const names = trimmed
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((token) => resolveMention(token, providers) ?? token);
  return { kind: 'named', names: [...new Set(names)] };
}

/** The providers a selection stands for, validated against what is available right now. */
export function resolveProviderSelection(
  selection: ProviderSelection,
  available: readonly ProviderName[],
  fallback?: string
): string[] {
  if (available.length === 0) throw new Error('No Rubber Duck provider is configured');
  const names = available.map((provider) => provider.name);
  if (selection.kind === 'all') return names;
  if (selection.kind === 'named') {
    const resolved = selection.names.map((name) => {
      const match = resolveMention(name, available);
      if (!match) {
        throw new Error(`Unknown provider: ${name} (available: ${names.join(', ')})`);
      }
      return match;
    });
    return [...new Set(resolved)];
  }
  const first =
    fallback ?? available.find((provider) => provider.type === 'cli')?.name ?? available[0].name;
  return [first];
}
