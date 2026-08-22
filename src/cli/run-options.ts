import { resolve } from 'path';
import type { RunResearchInput } from '../research/types.js';

export const DEFAULT_REPOSITORY_GOAL =
  'Analyze this repository and generate hypotheses about its design, correctness risks, and highest-value next experiments.';

export interface RunCliOptions {
  goalParts: string[];
  contextPaths: string[];
  repositoryPath?: string;
  providers?: string[];
  hypothesesPerProvider?: number;
  topK?: number;
  minProviders?: number;
  seed?: number;
  maxContextBytes?: number;
  markdownOnly?: boolean;
}

export function createRunInput(options: RunCliOptions, cwd = process.cwd()): RunResearchInput {
  const contextRoot = resolve(cwd, options.repositoryPath || '.');
  return {
    goal: options.goalParts.join(' ').trim() || DEFAULT_REPOSITORY_GOAL,
    contextPaths: options.contextPaths.length > 0 ? options.contextPaths : ['.'],
    contextRoot,
    providers: options.providers,
    hypothesesPerProvider: options.hypothesesPerProvider,
    topK: options.topK,
    minProviders: options.minProviders,
    seed: options.seed,
    maxContextBytes: options.maxContextBytes,
    markdownOnly: options.markdownOnly === true,
  };
}
