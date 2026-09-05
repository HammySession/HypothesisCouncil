import { resolve } from 'path';
import type { DialConfig, RunResearchInput, SessionMeta, WebAccess } from '../research/types.js';

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
  /** Resolved novelty and skepticism dials with their origins. */
  dials?: DialConfig;
  /** Sources file (JSON or Markdown), relative to `cwd`. */
  sourcesFile?: string;
  /** Scout providers; undefined lets the service pick every `*_scout` provider. */
  scouts?: string[];
  web?: WebAccess;
  meta?: SessionMeta;
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
    dials: options.dials,
    sourcesFile: options.sourcesFile ? resolve(cwd, options.sourcesFile) : undefined,
    scouts: options.scouts,
    web: options.web,
    meta: options.meta,
  };
}
