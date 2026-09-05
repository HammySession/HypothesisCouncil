import type { ParsedArguments } from '../arguments.js';
import { basketPaths, basketSize } from './basket.js';
import type { ShellState } from './context.js';

/** What `/run` inherits from the shell when the line does not say otherwise. */
export interface RunDefaults {
  repositoryPath: string;
  contextPaths: string[];
  markdownOnly: boolean;
}

/** The single place later features extend: repo root, basket paths, and Markdown mode. */
export function runDefaultsFromState(state: ShellState): RunDefaults {
  return {
    repositoryPath: state.repoRoot,
    contextPaths: basketSize(state.basket) > 0 ? basketPaths(state.basket) : [],
    markdownOnly: state.basket.markdownOnly,
  };
}

/** Write the defaults into a parsed `/run` line; explicit flags win. */
export function applyRunDefaults(parsed: ParsedArguments, defaults: RunDefaults): ParsedArguments {
  if (!parsed.flags.has('--repo')) parsed.flags.set('--repo', [defaults.repositoryPath]);
  if (!parsed.flags.has('--context') && defaults.contextPaths.length > 0) {
    parsed.flags.set('--context', [...defaults.contextPaths]);
  }
  if (!parsed.flags.has('--markdown-only') && defaults.markdownOnly) {
    parsed.flags.set('--markdown-only', ['true']);
  }
  return parsed;
}
