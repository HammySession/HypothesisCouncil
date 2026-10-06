import { existsSync } from 'fs';
import { join } from 'path';
import { resolveStdinShimPath } from '../rubber-duck/launch.js';
import {
  scoutProfileEnvironment,
  scoutProviderName,
  type ScoutVendor,
} from '../rubber-duck/scout-profiles.js';
import {
  describeModelOrigin,
  resolveModelChoice,
  type ModelVendor,
  type ResolvedModel,
} from './model-selection.js';
import { findCommand } from './path-lookup.js';

const DEFAULT_PRESET_TIMEOUT_MS = 5 * 60 * 1000;

/** The preset used when a run names none and the person configured no providers themselves. */
export const DEFAULT_PRESET = 'auto';

/** Vendor CLIs the auto preset seats, in council order, with the Rubber Duck provider each becomes. */
const AUTO_VENDORS: ReadonlyArray<{ command: ScoutVendor; provider: string }> = [
  { command: 'claude', provider: 'cli-claude' },
  { command: 'codex', provider: 'cli-codex' },
];

export const INSTALL_HINT =
  'Install Claude Code (npm install -g @anthropic-ai/claude-code) or Codex (npm install -g @openai/codex), sign in once, then run hc doctor.';

export const NO_PROVIDER_CLI_MESSAGE = `No supported AI CLI was found on PATH and no Rubber Duck provider is configured. ${INSTALL_HINT}`;

/** One model a preset chooses per vendor; discovery may replace the pin under the `latest` policy. */
export interface ModelSlot {
  /** Key used by `--model KEY=ID` and in reports, for example `codex`. */
  key: string;
  vendor: ModelVendor;
  /** Rubber Duck provider the slot configures, for example `cli-codex`. */
  providerName: string;
  /** Variables a person may set before any preset runs to pin the model explicitly. */
  modelEnvVars: string[];
  /** The id used under the `pinned` policy and when discovery fails. */
  pinned: string;
  /** Context window to assume for the pinned id when discovery reports none. */
  pinnedContextTokens?: number;
}

export interface PresetContext {
  /** Node executable that runs the stdin shim. */
  execPath: string;
  /** Absolute path of the built stdin shim. */
  shimPath: string;
  /** Provider process timeout in milliseconds, already reconciled with the user's environment. */
  timeoutMs: string;
  /** Resolved model per slot key; defaults to the preset's pins. */
  models: Record<string, ResolvedModel>;
  /** The person's environment, for overrides such as the Codex web-search config. */
  environment?: NodeJS.ProcessEnv;
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
  /**
   * Web scout vendors the preset configures as extra providers (`cli-<vendor>_scout`). Scouts
   * propose sources during the sources stage and never sit on the council.
   */
  scouts?: ScoutVendor[];
  /** Provider process timeout the preset needs; `HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS` wins. */
  providerTimeoutMs?: number;
  modelSlots?: ModelSlot[];
  /** Rubber Duck environment. A value of `undefined` removes the variable. */
  environment(context: PresetContext): Record<string, string | undefined>;
}

function shimArgs(mode: 'prompt-file' | 'agy-stream-json', shimPath: string, command: string[]) {
  return [shimPath, mode, '--', ...command].join(',');
}

/** Environment variable holding the context window the council should assume for a provider. */
export function contextTokensVariable(providerName: string): string {
  return `HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_${providerName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
}

function tokens(model: ResolvedModel | undefined): string | undefined {
  return model?.contextWindowTokens === undefined ? undefined : String(model.contextWindowTokens);
}

/** Rubber Duck provider names of a preset's scouts, in a stable order. */
export function presetScoutProviders(preset: CouncilPreset): string[] {
  return (preset.scouts ?? []).map(scoutProviderName).sort();
}

const FRONTIER_SLOTS: ModelSlot[] = [
  {
    key: 'grok',
    vendor: 'grok',
    providerName: 'cli-grok',
    modelEnvVars: ['CLI_CUSTOM_GROK_DEFAULT_MODEL', 'CLI_GROK_DEFAULT_MODEL'],
    pinned: 'grok-4.7',
  },
  {
    key: 'agy',
    vendor: 'gemini',
    providerName: 'cli-agy',
    modelEnvVars: ['CLI_CUSTOM_AGY_DEFAULT_MODEL'],
    pinned: 'gemini-3.8-flash-high',
    pinnedContextTokens: 1_000_000,
  },
  {
    key: 'claude',
    vendor: 'claude',
    providerName: 'cli-claude',
    modelEnvVars: ['CLI_CLAUDE_DEFAULT_MODEL'],
    pinned: 'claude-fable-5-1[1m]',
    pinnedContextTokens: 1_000_000,
  },
  {
    key: 'codex',
    vendor: 'codex',
    providerName: 'cli-codex',
    modelEnvVars: ['CLI_CODEX_DEFAULT_MODEL'],
    pinned: 'gpt-6.1-sol',
    pinnedContextTokens: 272_000,
  },
];

/**
 * The auto preset seats whichever of Claude Code and Codex are installed. `found` lists the
 * vendor commands on PATH; with none the preset has no providers and a run reports how to install one.
 */
export function autoPreset(found: readonly string[]): CouncilPreset {
  const vendors = AUTO_VENDORS.filter((vendor) => found.includes(vendor.command));
  const commands = vendors.map((vendor) => vendor.command);
  return {
    name: DEFAULT_PRESET,
    summary:
      'Claude Code and Codex, whichever are installed, with their default models. Used when no preset or provider is configured.',
    providers: vendors.map((vendor) => vendor.provider),
    minProviders: Math.min(2, vendors.length),
    requiredCommands: commands,
    scouts: commands,
    environment: ({ execPath, shimPath, timeoutMs, environment }) => {
      const values: Record<string, string | undefined> = {
        CLI_CLAUDE_ENABLED: commands.includes('claude') ? 'true' : undefined,
        CLI_CODEX_ENABLED: commands.includes('codex') ? 'true' : undefined,
      };
      for (const vendor of commands) {
        Object.assign(
          values,
          scoutProfileEnvironment(vendor, { execPath, shimPath, timeoutMs, environment })
        );
      }
      return values;
    },
  };
}

export const PRESETS: readonly CouncilPreset[] = [
  autoPreset(AUTO_VENDORS.map((vendor) => vendor.command)),
  {
    name: 'frontier',
    summary:
      'Grok, Gemini (through AGY), Claude Code, and Codex at high reasoning effort. All four CLIs are required. The newest model per vendor is chosen automatically unless the model policy is pinned.',
    providers: ['cli-grok', 'cli-agy', 'cli-claude', 'cli-codex'],
    minProviders: 4,
    requiredCommands: ['agy', 'claude', 'codex', 'grok'],
    providerTimeoutMs: 15 * 60 * 1000,
    modelSlots: FRONTIER_SLOTS,
    scouts: ['claude', 'codex', 'grok'],
    environment: ({ execPath, shimPath, timeoutMs, models, environment }) => {
      const grok = models.grok.id;
      const agy = models.agy.id;
      const claude = models.claude.id;
      const codex = models.codex.id;
      const scout = (vendor: ScoutVendor, model: string, reasoningEffort?: string) =>
        scoutProfileEnvironment(vendor, {
          execPath,
          shimPath,
          model,
          reasoningEffort,
          timeoutMs,
          environment,
        });
      return {
        HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS: timeoutMs,

        // Grok with extra-high reasoning. Grok accepts a prompt file, so the shim moves the
        // council packet off the command line. Grok searches the web by default; the council
        // answers from the sealed context packet only, so web search is switched off.
        CLI_GROK_ENABLED: undefined,
        CLI_CUSTOM_GROK_COMMAND: execPath,
        CLI_CUSTOM_GROK_PROMPT_DELIVERY: 'stdin',
        CLI_CUSTOM_GROK_OUTPUT_FORMAT: 'text',
        CLI_CUSTOM_GROK_DEFAULT_MODEL: grok,
        CLI_CUSTOM_GROK_NICKNAME: 'Grok Expert',
        CLI_CUSTOM_GROK_CLI_ARGS: shimArgs('prompt-file', shimPath, [
          'grok',
          '-m',
          grok,
          '--reasoning-effort',
          'xhigh',
          '--disable-web-search',
        ]),
        CLI_CUSTOM_GROK_PROCESS_TIMEOUT: timeoutMs,
        HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_GROK: tokens(models.grok),

        // Gemini through Google Antigravity (AGY), not Gemini CLI. AGY reads stream-json
        // messages from stdin, which the shim produces.
        CLI_GEMINI_ENABLED: undefined,
        CLI_CUSTOM_AGY_COMMAND: execPath,
        CLI_CUSTOM_AGY_PROMPT_DELIVERY: 'stdin',
        CLI_CUSTOM_AGY_OUTPUT_FORMAT: 'text',
        CLI_CUSTOM_AGY_DEFAULT_MODEL: agy,
        CLI_CUSTOM_AGY_NICKNAME: 'Gemini Thinking',
        CLI_CUSTOM_AGY_CLI_ARGS: shimArgs('agy-stream-json', shimPath, [
          'agy',
          '--model',
          agy,
          '--effort',
          'high',
          '--sandbox',
        ]),
        CLI_CUSTOM_AGY_PROCESS_TIMEOUT: timeoutMs,
        HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_AGY: tokens(models.agy),

        // Claude Code; the discovered id normally carries its one-million-token profile.
        CLI_CLAUDE_ENABLED: 'true',
        CLI_CLAUDE_DEFAULT_MODEL: claude,
        HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_CLAUDE: tokens(models.claude),

        // Codex with extra-high reasoning; the catalog's context window is trusted as-is.
        CLI_CODEX_ENABLED: 'true',
        CLI_CODEX_DEFAULT_MODEL: codex,
        HYPOTHESIS_COUNCIL_CODEX_REASONING_EFFORT: 'xhigh',
        HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_CODEX: tokens(models.codex),

        // Web scouts: the same vendors with exactly the web tools open. They propose sources
        // for the sources stage and are never council members.
        ...scout('claude', claude),
        ...scout('codex', codex, 'high'),
        ...scout('grok', grok, 'high'),
      };
    },
  },
  {
    name: 'quick',
    summary:
      'Claude Code and Codex with their default models. A fast two-provider council for smoke tests.',
    providers: ['cli-claude', 'cli-codex'],
    minProviders: 2,
    requiredCommands: ['claude', 'codex'],
    scouts: ['claude', 'codex'],
    environment: ({ execPath, shimPath, timeoutMs, environment }) => ({
      CLI_CLAUDE_ENABLED: 'true',
      CLI_CODEX_ENABLED: 'true',
      ...scoutProfileEnvironment('claude', { execPath, shimPath, timeoutMs, environment }),
      ...scoutProfileEnvironment('codex', { execPath, shimPath, timeoutMs, environment }),
    }),
  },
];

/**
 * The preset called `name`. `auto` is built from the vendor CLIs `locate` finds, so callers that
 * can see the person's PATH pass their own lookup.
 */
export function findPreset(
  name: string,
  locate: (command: string) => string | undefined = (command) => findCommand(command)
): CouncilPreset {
  if (name === DEFAULT_PRESET) {
    return autoPreset(AUTO_VENDORS.map((vendor) => vendor.command).filter((c) => locate(c)));
  }
  const preset = PRESETS.find((candidate) => candidate.name === name);
  if (!preset) {
    throw new Error(
      `Unknown preset: ${name}. Available presets: ${PRESETS.map((candidate) => candidate.name).join(', ')}`
    );
  }
  return preset;
}

/** The preset's pins as resolved models; what `applyPreset` uses when no discovery ran. */
export function pinnedModels(preset: CouncilPreset): Record<string, ResolvedModel> {
  return Object.fromEntries(
    (preset.modelSlots ?? []).map((slot) => [
      slot.key,
      resolveModelChoice({
        vendor: slot.vendor,
        policy: 'pinned',
        pinned: slot.pinned,
        pinnedContextTokens: slot.pinnedContextTokens,
      }),
    ])
  );
}

/** `*_DEFAULT_MODEL` values a person set before any preset ran, keyed by slot. */
export function explicitModelsFromEnvironment(
  snapshot: NodeJS.ProcessEnv,
  preset: CouncilPreset
): Record<string, string> {
  const explicit: Record<string, string> = {};
  for (const slot of preset.modelSlots ?? []) {
    for (const name of slot.modelEnvVars) {
      const value = snapshot[name]?.trim();
      if (value) {
        explicit[slot.key] = value;
        break;
      }
    }
  }
  return explicit;
}

/** A context-window override the person set themselves, which presets must not replace. */
export function explicitContextTokens(
  snapshot: NodeJS.ProcessEnv,
  providerName: string
): string | undefined {
  const value = snapshot[contextTokensVariable(providerName)]?.trim();
  return value || undefined;
}

/** Resolved models keyed by Rubber Duck provider name, for doctor and status output. */
export function modelsByProvider(
  preset: CouncilPreset,
  models: Record<string, ResolvedModel>
): Record<string, ResolvedModel> {
  const byProvider: Record<string, ResolvedModel> = {};
  for (const slot of preset.modelSlots ?? []) {
    const model = models[slot.key];
    if (model) byProvider[slot.providerName] = model;
  }
  return byProvider;
}

/** `grok=grok-4.7 (auto: latest of 4) · codex=gpt-6.1-sol (pinned)`. */
export function describeModels(
  preset: CouncilPreset,
  models: Record<string, ResolvedModel>
): string {
  return (preset.modelSlots ?? [])
    .flatMap((slot) => {
      const model = models[slot.key];
      return model ? [`${slot.key}=${model.id} (${describeModelOrigin(model)})`] : [];
    })
    .join(' · ');
}

export interface ApplyPresetOptions {
  execPath?: string;
  shimPath?: string;
  /** Resolved models per slot; defaults to the preset pins. */
  models?: Record<string, ResolvedModel>;
  /**
   * The environment before any preset ran. Values a person set there (timeout, context
   * windows, default models) are kept; defaults to the environment being written.
   */
  snapshot?: NodeJS.ProcessEnv;
}

/**
 * Write a preset's provider configuration into an environment (normally `process.env`) before the
 * Rubber Duck subprocess is launched. Existing `HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS`, explicit
 * context-window overrides, and explicit default models are kept.
 */
export function applyPreset(
  preset: CouncilPreset,
  environment: NodeJS.ProcessEnv,
  options: ApplyPresetOptions = {}
): NodeJS.ProcessEnv {
  const snapshot = options.snapshot ?? environment;
  const timeoutMs =
    snapshot.HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS ||
    environment.HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS ||
    String(preset.providerTimeoutMs ?? DEFAULT_PRESET_TIMEOUT_MS);
  const values = preset.environment({
    execPath: options.execPath || process.execPath,
    shimPath: options.shimPath || resolveStdinShimPath(),
    timeoutMs,
    models: options.models ?? pinnedModels(preset),
    environment: snapshot,
  });
  const preserved = new Set<string>();
  for (const slot of preset.modelSlots ?? []) {
    const contextVariable = contextTokensVariable(slot.providerName);
    if (explicitContextTokens(snapshot, slot.providerName)) preserved.add(contextVariable);
    for (const name of slot.modelEnvVars) if (snapshot[name]?.trim()) preserved.add(name);
  }
  for (const [key, value] of Object.entries(values)) {
    if (preserved.has(key)) continue;
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
  return environment;
}

export function missingPresetCommands(
  preset: CouncilPreset,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  locate: (command: string) => string | undefined = (command) =>
    findCommand(command, environment, platform)
): string[] {
  return preset.requiredCommands.filter((command) => !locate(command));
}

/** Variables Rubber Duck reads to enable a provider; any of them means the person configured one. */
const PROVIDER_VARIABLE_PATTERN =
  /^(CLI_[A-Z0-9_]+_ENABLED|CLI_CUSTOM_[A-Z0-9_]+_COMMAND|CUSTOM_[A-Z0-9_]+_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|GROQ_API_KEY|ENABLE_OLLAMA|OLLAMA_BASE_URL)$/;

/**
 * True when the person configured at least one Rubber Duck provider themselves, through its
 * environment variables or its config file, so the auto preset must stay out of the way.
 */
export function providersConfigured(
  environment: NodeJS.ProcessEnv,
  homeDirectory: string | undefined
): boolean {
  const configured = Object.entries(environment).some(
    ([key, value]) => PROVIDER_VARIABLE_PATTERN.test(key) && value?.trim()
  );
  if (configured) return true;
  return (
    homeDirectory !== undefined &&
    existsSync(join(homeDirectory, '.mcp-rubber-duck', 'config.json'))
  );
}

export function presetsText(): string {
  const width = Math.max(...PRESETS.map((preset) => preset.name.length));
  const indent = ' '.repeat(width);
  return [
    'Council presets (use with hc run --preset NAME or hc doctor --preset NAME):',
    ...PRESETS.map((preset) => {
      const lines = [
        `  ${preset.name.padEnd(width)}  ${preset.summary}`,
        `  ${indent}  providers: ${preset.providers.join(', ')}; requires: ${preset.requiredCommands.join(', ')}${preset.name === DEFAULT_PRESET ? ' (whichever are installed)' : ''}`,
      ];
      if (preset.scouts?.length) {
        lines.push(
          `  ${indent}  web scouts: ${presetScoutProviders(preset).join(', ')} (propose sources; never on the council)`
        );
      }
      if (preset.modelSlots?.length) {
        lines.push(
          `  ${indent}  pinned models: ${preset.modelSlots.map((slot) => `${slot.key}=${slot.pinned}`).join(', ')} (hc models --preset ${preset.name} shows the automatic choice)`
        );
      }
      return lines.join('\n');
    }),
  ].join('\n');
}
