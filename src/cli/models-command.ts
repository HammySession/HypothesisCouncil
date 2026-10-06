import type { ResearchSessionStore } from '../research/store.js';
import { flag, hasFlag, parseModelFlags, type ParsedArguments } from './arguments.js';
import type { CliDependencies } from './dependencies.js';
import { formatDuration, table } from './format.js';
import { modelCachePath, type CouncilModels, type VendorDiscovery } from './model-discovery.js';
import { describeModelOrigin, type DiscoveredModel, type ModelVendor } from './model-selection.js';
import { resolvePresetModels } from './preset-selection.js';
import { findPreset, type CouncilPreset } from './presets.js';
import { resolveStoreSettings, settingsFlags } from './settings-command.js';

/** The only preset with model slots, so `hc models` shows it unless settings name another. */
export const DEFAULT_MODELS_PRESET = 'frontier';

function describeDiscovered(model: DiscoveredModel): string {
  const notes = [
    model.hidden ? 'hidden' : '',
    model.supersededBy ? `superseded by ${model.supersededBy}` : '',
  ].filter(Boolean);
  return notes.length > 0 ? `${model.id} (${notes.join(', ')})` : model.id;
}

function describeSource(discovery: VendorDiscovery | undefined): string {
  if (!discovery) return 'not needed';
  const base = `${discovery.source}${discovery.detail ? `: ${discovery.detail}` : ''}`;
  return discovery.fresh ? base : `${base} (stale)`;
}

/** Human-readable listing for `hc models` and `/models`. */
export function modelsText(
  preset: CouncilPreset,
  result: CouncilModels,
  options: { policy: string; cachePath: string; ttlMs?: number; now?: number }
): string {
  const slots = preset.modelSlots ?? [];
  if (slots.length === 0) {
    return `Preset ${preset.name} has no model slots; each CLI runs its own default model.`;
  }
  const lines = [`Models for preset ${preset.name} (policy: ${options.policy})`];
  lines.push(
    ...table(
      ['SLOT', 'PROVIDER', 'MODEL', 'ORIGIN', 'WINDOW', 'SOURCE'],
      slots.map((slot) => {
        const model = result.models[slot.key];
        return [
          slot.key,
          slot.providerName,
          model?.id ?? slot.pinned,
          model ? describeModelOrigin(model) : 'pinned',
          model?.contextWindowTokens === undefined
            ? 'by model id'
            : model.contextWindowTokens.toLocaleString(),
          describeSource(result.discoveries[slot.vendor]),
        ];
      })
    )
  );
  const listed = Object.values(result.discoveries).filter(
    (discovery) => discovery.models.length > 0
  );
  if (listed.length > 0) {
    lines.push('', 'Discovered ids:');
    for (const discovery of listed) {
      const age =
        options.now === undefined
          ? ''
          : ` ${formatDuration(Math.max(0, options.now - Date.parse(discovery.fetchedAt)))} ago`;
      lines.push(
        `  ${discovery.vendor} (${discovery.models.length}${age}): ${discovery.models.map(describeDiscovered).join(', ')}`
      );
      if (discovery.error) lines.push(`    warning: ${discovery.error}`);
    }
  }
  lines.push(
    '',
    `Cache: ${options.cachePath}${options.ttlMs ? ` (kept ${formatDuration(options.ttlMs)})` : ''}; --refresh asks the vendor CLIs again.`,
    'Override with --model KEY=ID, CLI_*_DEFAULT_MODEL, or `hc settings set modelPolicy pinned`.'
  );
  return lines.join('\n');
}

/** `hc models [--preset NAME] [--refresh] [--json] [--model KEY=ID]`. */
export async function executeModels(
  parsed: ParsedArguments,
  store: ResearchSessionStore,
  deps: CliDependencies
): Promise<number> {
  const settings = resolveStoreSettings(store, deps.env, settingsFlags(parsed));
  const name = flag(parsed, '--preset') ?? settings.values.defaultPreset ?? DEFAULT_MODELS_PRESET;
  if (name === 'true') throw new Error('--preset requires a name; run `hc presets` to list them');
  const preset = findPreset(name, deps.locateCommand);
  const result = await resolvePresetModels(preset, deps, {
    store,
    settings,
    explicitModels: parseModelFlags(parsed),
    refresh: hasFlag(parsed, '--refresh'),
  });
  const policy = settings.values.modelPolicy;
  if (hasFlag(parsed, '--json')) {
    deps.io.out(
      JSON.stringify(
        {
          preset: preset.name,
          policy,
          models: result.models,
          discoveries: Object.fromEntries(
            Object.values(result.discoveries).map((discovery) => [discovery.vendor, discovery])
          ) as Partial<Record<ModelVendor, VendorDiscovery>>,
        },
        null,
        2
      )
    );
    return 0;
  }
  deps.io.out(
    modelsText(preset, result, { policy, cachePath: modelCachePath(store.root), now: deps.now() })
  );
  return 0;
}
