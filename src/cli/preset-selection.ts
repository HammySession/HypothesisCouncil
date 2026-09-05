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
import { applyPreset, findPreset, missingPresetCommands, type CouncilPreset } from './presets.js';

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
 * Apply `--preset NAME` (or the settings default when the line names none) to the environment
 * before any Rubber Duck subprocess starts, with the models resolved for the current policy.
 * With `strict`, missing vendor CLIs abort early instead of failing minutes later in preflight.
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
  const preset = findPreset(name);
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
