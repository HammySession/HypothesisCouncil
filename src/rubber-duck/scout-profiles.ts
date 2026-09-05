import { agyArgs, claudeArgs, codexArgs, grokArgs } from './vendor-args.js';

/**
 * Web scout provider profiles. A scout is a second Rubber Duck provider for a vendor CLI, named
 * `cli-<vendor>_scout`, configured with exactly the web tools open and everything else closed.
 * Scouts propose sources during the sources stage and never sit on the council.
 */
export type ScoutVendor = 'claude' | 'codex' | 'gemini' | 'grok';

export const SCOUT_VENDORS: readonly ScoutVendor[] = ['claude', 'codex', 'gemini', 'grok'];

/** Claude Code tools a scout may use; the rest of the built-in set stays off. */
export const CLAUDE_SCOUT_TOOLS = ['WebSearch', 'WebFetch'] as const;

/** Environment variable overriding the Codex config override that enables live web search. */
export const CODEX_WEB_SEARCH_VARIABLE = 'HYPOTHESIS_COUNCIL_CODEX_WEB_SEARCH_CONFIG';
export const DEFAULT_CODEX_WEB_SEARCH_CONFIG = 'web_search="live"';

/** Turns a scout may spend searching and fetching before it must answer. */
export const DEFAULT_SCOUT_MAX_TURNS = 12;

/** Rubber Duck key of a vendor's scout provider (`CLI_CUSTOM_CLAUDE_SCOUT_*`). */
export function scoutEnvironmentKey(vendor: ScoutVendor): string {
  return `${vendor === 'gemini' ? 'AGY' : vendor.toUpperCase()}_SCOUT`;
}

/** Rubber Duck provider name the scout key produces (`cli-claude_scout`). */
export function scoutProviderName(vendor: ScoutVendor): string {
  return `cli-${scoutEnvironmentKey(vendor).toLowerCase()}`;
}

export interface ScoutProfileOptions {
  /** Node executable that runs the stdin shim. */
  execPath: string;
  /** Absolute path of the built stdin shim. */
  shimPath: string;
  model?: string;
  /** Grok and Codex reasoning effort, or AGY effort. */
  reasoningEffort?: string;
  timeoutMs: string;
  maxTurns?: number;
  /** Environment consulted for overrides such as the Codex web-search config. */
  environment?: NodeJS.ProcessEnv;
}

function shimArgs(mode: 'prompt-file' | 'agy-stream-json', shimPath: string, command: string[]) {
  return [shimPath, mode, '--', ...command].join(',');
}

/**
 * Rubber Duck environment for one vendor's scout. The council profile for the same vendor is
 * untouched: scouts are separate providers with their own command lines.
 */
export function scoutProfileEnvironment(
  vendor: ScoutVendor,
  options: ScoutProfileOptions
): Record<string, string> {
  const key = scoutEnvironmentKey(vendor);
  const prefix = `CLI_CUSTOM_${key}_`;
  const common: Record<string, string> = {
    [`${prefix}PROMPT_DELIVERY`]: 'stdin',
    [`${prefix}PROCESS_TIMEOUT`]: options.timeoutMs,
  };
  if (options.model) common[`${prefix}DEFAULT_MODEL`] = options.model;
  switch (vendor) {
    case 'claude':
      return {
        ...common,
        [`${prefix}COMMAND`]: 'claude',
        [`${prefix}OUTPUT_FORMAT`]: 'json',
        [`${prefix}NICKNAME`]: 'Claude Scout',
        [`${prefix}CLI_ARGS`]: claudeArgs({
          model: options.model,
          maxTurns: options.maxTurns ?? DEFAULT_SCOUT_MAX_TURNS,
          tools: [...CLAUDE_SCOUT_TOOLS],
          restricted: true,
        }).join(','),
      };
    case 'codex': {
      const webSearch =
        options.environment?.[CODEX_WEB_SEARCH_VARIABLE]?.trim() || DEFAULT_CODEX_WEB_SEARCH_CONFIG;
      if (webSearch.includes(',')) {
        throw new Error(`${CODEX_WEB_SEARCH_VARIABLE} must not contain commas`);
      }
      return {
        ...common,
        [`${prefix}COMMAND`]: 'codex',
        [`${prefix}OUTPUT_FORMAT`]: 'text',
        [`${prefix}NICKNAME`]: 'Codex Scout',
        [`${prefix}CLI_ARGS`]: codexArgs({
          model: options.model,
          reasoningEffort: options.reasoningEffort,
          configOverrides: [webSearch],
        }).join(','),
      };
    }
    case 'grok':
      return {
        ...common,
        [`${prefix}COMMAND`]: options.execPath,
        [`${prefix}OUTPUT_FORMAT`]: 'text',
        [`${prefix}NICKNAME`]: 'Grok Scout',
        [`${prefix}CLI_ARGS`]: shimArgs(
          'prompt-file',
          options.shimPath,
          grokArgs({
            model: options.model,
            reasoningEffort: options.reasoningEffort,
            webSearch: true,
          })
        ),
      };
    case 'gemini':
      return {
        ...common,
        [`${prefix}COMMAND`]: options.execPath,
        [`${prefix}OUTPUT_FORMAT`]: 'text',
        [`${prefix}NICKNAME`]: 'Gemini Scout',
        [`${prefix}CLI_ARGS`]: shimArgs(
          'agy-stream-json',
          options.shimPath,
          agyArgs({ model: options.model, effort: options.reasoningEffort })
        ),
      };
  }
}

/** Every variable a scout profile may set, so a preset can clear them when scouts are off. */
export function scoutEnvironmentVariables(vendor: ScoutVendor): string[] {
  const prefix = `CLI_CUSTOM_${scoutEnvironmentKey(vendor)}_`;
  return [
    'COMMAND',
    'PROMPT_DELIVERY',
    'OUTPUT_FORMAT',
    'NICKNAME',
    'DEFAULT_MODEL',
    'CLI_ARGS',
    'PROCESS_TIMEOUT',
  ].map((suffix) => `${prefix}${suffix}`);
}
