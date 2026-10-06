import type { ResolvedSettings } from '../research/settings.js';
import { flag, hasFlag, parseModelFlags, type ParsedArguments } from './arguments.js';
import type { CliDependencies } from './dependencies.js';
import {
  modelCachePath,
  resolveCouncilModels,
  type CouncilModels,
  type DiscoveryOptions,
} from './model-discovery.js';
import type { ResolvedModel } from './model-selection.js';
import {
  DEFAULT_PRESET,
  NO_PROVIDER_CLI_MESSAGE,
  applyPreset,
  findPreset,
  missingPresetCommands,
  providersConfigured,
  type CouncilPreset,
} from './presets.js';

export interface SelectedPreset {
  preset: CouncilPreset;
  models: Record<string, ResolvedModel>;
}

export interface SelectPresetOptions {
  store: { root: string };
  settings: ResolvedSettings;
  /** Used when the line names no preset; typically the settings default. */
  defaultName?: string;
  /** `--model KEY=ID` values; the shell passes none. */
  explicitModels?: Record<string, string>;
  refresh?: boolean;
}

/**
 * The preset a run uses when the line names none: the settings default, or `auto` when the
 * person configured no Rubber Duck provider themselves. Undefined means "run what Rubber Duck
 * already has".
 */
export function defaultPresetName(
  settings: ResolvedSettings,
  deps: Pick<CliDependencies, 'envSnapshot' | 'homeDirectory'>
): string | undefined {
  if (settings.values.defaultPreset) return settings.values.defaultPreset;
  return providersConfigured(deps.envSnapshot, deps.homeDirectory) ? undefined : DEFAULT_PRESET;
}

/** Discovery configuration for this process: session-home cache, injected runner and clock. */
export function discoveryOptionsFor(
  store: { root: string },
  deps: Pick<
    CliDependencies,
    'env' | 'platform' | 'homeDirectory' | 'locateCommand' | 'runVendorCommand' | 'now'
  >,
  refresh = false
): DiscoveryOptions {
  return {
    environment: deps.env,
    platform: deps.platform,
    homeDirectory: deps.homeDirectory,
    cachePath: modelCachePath(store.root),
    refresh,
    run: deps.runVendorCommand,
    locateCommand: deps.locateCommand,
    now: deps.now,
  };
}

/** Resolve the models a preset should run with, honouring the model policy and explicit ids. */
export function resolvePresetModels(
  preset: CouncilPreset,
  deps: Pick<
    CliDependencies,
    | 'env'
    | 'envSnapshot'
    | 'platform'
    | 'homeDirectory'
    | 'locateCommand'
    | 'runVendorCommand'
    | 'now'
  >,
  options: Pick<SelectPresetOptions, 'store' | 'settings' | 'explicitModels' | 'refresh'>
): Promise<CouncilModels> {
  return resolveCouncilModels(preset, {
    policy: options.settings.values.modelPolicy,
    explicit: options.explicitModels,
    snapshot: deps.envSnapshot,
    discovery: discoveryOptionsFor(options.store, deps, options.refresh),
  });
}

/**
 * Apply `--preset NAME` (or `defaultName` when the line names none) to the environment before
 * any Rubber Duck subprocess starts, with the models resolved for the current policy. With
 * `strict`, missing vendor CLIs abort early instead of failing minutes later in preflight.
 */
export async function selectPreset(
  parsed: ParsedArguments,
  strict: boolean,
  deps: CliDependencies,
  options: SelectPresetOptions
): Promise<SelectedPreset | undefined> {
  const name = flag(parsed, '--preset') ?? options.defaultName;
  if (name === undefined) return undefined;
  if (name === 'true') throw new Error('--preset requires a name; run `hc presets` to list them');
  const preset = findPreset(name, deps.locateCommand);
  if (preset.name === DEFAULT_PRESET && preset.providers.length === 0) {
    if (strict) throw new Error(NO_PROVIDER_CLI_MESSAGE);
    return { preset, models: {} };
  }
  const missing = missingPresetCommands(preset, deps.env, deps.platform, deps.locateCommand);
  if (strict && missing.length > 0) {
    throw new Error(
      `Preset ${preset.name} needs these commands on PATH: ${missing.join(', ')}. Run \`hc doctor --preset ${preset.name}\` for details.`
    );
  }
  const { models } = await resolvePresetModels(preset, deps, {
    store: options.store,
    settings: options.settings,
    explicitModels: options.explicitModels ?? parseModelFlags(parsed),
    refresh: options.refresh ?? hasFlag(parsed, '--refresh'),
  });
  applyPreset(preset, deps.env, { models, snapshot: deps.envSnapshot });
  return { preset, models };
}
