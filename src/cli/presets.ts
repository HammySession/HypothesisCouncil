import { resolveStdinShimPath } from '../rubber-duck/launch.js';
import { findCommand } from './path-lookup.js';

const DEFAULT_PRESET_TIMEOUT_MS = 5 * 60 * 1000;

export interface PresetContext {
  /** Node executable that runs the stdin shim. */
  execPath: string;
  /** Absolute path of the built stdin shim. */
  shimPath: string;
  /** Provider process timeout in milliseconds, already reconciled with the user's environment. */
  timeoutMs: string;
}

export interface CouncilPreset {
  name: string;
  summary: string;
  /** Rubber Duck provider names selected by default; `--providers` overrides them. */
  providers: string[];
  /** Default `--min-providers`. */
  minProviders: number;
  /** Vendor CLIs that must be on PATH before the preset can run. */
  requiredCommands: string[];
  /** Provider process timeout the preset needs; `HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS` wins. */
  providerTimeoutMs?: number;
  /** Rubber Duck environment. A value of `undefined` removes the variable. */
  environment(context: PresetContext): Record<string, string | undefined>;
}

function shimArgs(mode: 'prompt-file' | 'agy-stream-json', shimPath: string, command: string[]) {
  return [shimPath, mode, '--', ...command].join(',');
}

export const PRESETS: readonly CouncilPreset[] = [
  {
    name: 'frontier',
    summary:
      'Grok 4.6 (xhigh), Gemini 3.1 Pro High via AGY, Claude Fable 5 (1M), GPT-5.6 Sol (xhigh); all four required; prompts delivered through stdin so the shared packet is not capped by argument length',
    providers: ['cli-grok', 'cli-agy', 'cli-claude', 'cli-codex'],
    minProviders: 4,
    requiredCommands: ['agy', 'claude', 'codex', 'grok'],
    providerTimeoutMs: 15 * 60 * 1000,
    environment: ({ execPath, shimPath, timeoutMs }) => ({
      HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS: timeoutMs,

      // Grok 4.6 with extra-high reasoning. Grok accepts a prompt file, so the shim moves the
      // council packet off the command line.
      CLI_GROK_ENABLED: undefined,
      CLI_CUSTOM_GROK_COMMAND: execPath,
      CLI_CUSTOM_GROK_PROMPT_DELIVERY: 'stdin',
      CLI_CUSTOM_GROK_OUTPUT_FORMAT: 'text',
      CLI_CUSTOM_GROK_DEFAULT_MODEL: 'grok-4.6',
      CLI_CUSTOM_GROK_NICKNAME: 'Grok Expert',
      CLI_CUSTOM_GROK_CLI_ARGS: shimArgs('prompt-file', shimPath, [
        'grok',
        '-m',
        'grok-4.6',
        '--reasoning-effort',
        'xhigh',
      ]),
      CLI_CUSTOM_GROK_PROCESS_TIMEOUT: timeoutMs,

      // Gemini 3.1 Pro High through Google Antigravity (AGY), not Gemini CLI. AGY reads
      // stream-json messages from stdin, which the shim produces.
      CLI_GEMINI_ENABLED: undefined,
      CLI_CUSTOM_AGY_COMMAND: execPath,
      CLI_CUSTOM_AGY_PROMPT_DELIVERY: 'stdin',
      CLI_CUSTOM_AGY_OUTPUT_FORMAT: 'text',
      CLI_CUSTOM_AGY_DEFAULT_MODEL: 'gemini-3.1-pro-high',
      CLI_CUSTOM_AGY_NICKNAME: 'Gemini Thinking',
      CLI_CUSTOM_AGY_CLI_ARGS: shimArgs('agy-stream-json', shimPath, [
        'agy',
        '--model',
        'gemini-3.1-pro-high',
        '--effort',
        'high',
        '--sandbox',
      ]),
      CLI_CUSTOM_AGY_PROCESS_TIMEOUT: timeoutMs,
      HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_AGY: '1000000',

      // Claude Fable 5 with its one-million-token context profile.
      CLI_CLAUDE_ENABLED: 'true',
      CLI_CLAUDE_DEFAULT_MODEL: 'claude-fable-5[1m]',
      HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_CLAUDE: '1000000',

      // GPT-5.6 Sol with extra-high reasoning.
      CLI_CODEX_ENABLED: 'true',
      CLI_CODEX_DEFAULT_MODEL: 'gpt-5.6-sol',
      HYPOTHESIS_COUNCIL_CODEX_REASONING_EFFORT: 'xhigh',
      HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_CODEX: '1050000',
    }),
  },
  {
    name: 'quick',
    summary:
      'Claude Code and Codex with their default models; a fast two-provider council for smoke tests',
    providers: ['cli-claude', 'cli-codex'],
    minProviders: 2,
    requiredCommands: ['claude', 'codex'],
    environment: () => ({
      CLI_CLAUDE_ENABLED: 'true',
      CLI_CODEX_ENABLED: 'true',
    }),
  },
];

export function findPreset(name: string): CouncilPreset {
  const preset = PRESETS.find((candidate) => candidate.name === name);
  if (!preset) {
    throw new Error(
      `Unknown preset: ${name}. Available presets: ${PRESETS.map((candidate) => candidate.name).join(', ')}`
    );
  }
  return preset;
}

export interface ApplyPresetOptions {
  execPath?: string;
  shimPath?: string;
}

/**
 * Write a preset's provider configuration into an environment (normally `process.env`) before the
 * Rubber Duck subprocess is launched. Existing `HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS` is kept.
 */
export function applyPreset(
  preset: CouncilPreset,
  environment: NodeJS.ProcessEnv,
  options: ApplyPresetOptions = {}
): NodeJS.ProcessEnv {
  const timeoutMs =
    environment.HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS ||
    String(preset.providerTimeoutMs ?? DEFAULT_PRESET_TIMEOUT_MS);
  const values = preset.environment({
    execPath: options.execPath || process.execPath,
    shimPath: options.shimPath || resolveStdinShimPath(),
    timeoutMs,
  });
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
  return environment;
}

export function missingPresetCommands(
  preset: CouncilPreset,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string[] {
  return preset.requiredCommands.filter((command) => !findCommand(command, environment, platform));
}

export function presetsText(): string {
  const width = Math.max(...PRESETS.map((preset) => preset.name.length));
  return [
    'Council presets (use with hc run --preset NAME or hc doctor --preset NAME):',
    ...PRESETS.map(
      (preset) =>
        `  ${preset.name.padEnd(width)}  ${preset.summary}\n  ${' '.repeat(width)}  providers: ${preset.providers.join(', ')}; requires: ${preset.requiredCommands.join(', ')}`
    ),
  ].join('\n');
}
