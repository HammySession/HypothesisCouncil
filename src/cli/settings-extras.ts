import type { ResearchSessionStore } from '../research/store.js';
import { withCouncilRuntime } from '../runtime.js';
import type { CliDependencies } from './dependencies.js';
import { describeModelOrigin } from './model-selection.js';
import { resolvePresetModels } from './preset-selection.js';
import { findPreset, type CouncilPreset } from './presets.js';
import { resolveStoreSettings } from './settings-command.js';
import type { SettingsRow } from './settings-view.js';
import { basketSize } from './shell/basket.js';
import { describeSelection, type ShellState } from './shell/context.js';

/**
 * Rows appended to the settings view: the active preset and the model each slot resolves to,
 * the shell's own state (repository, session, ducks, context basket), and optionally the Rubber
 * Duck providers that are configured right now. Provider rows carry names and models only.
 */

export interface SettingsExtrasOptions {
  state?: ShellState;
  /** Start Rubber Duck and list its providers (slower). */
  providers?: boolean;
}

function activePreset(
  state: ShellState | undefined,
  defaultPreset: string | undefined
): { preset?: CouncilPreset; origin: string; error?: string } {
  if (state?.preset) return { preset: state.preset, origin: 'shell (/preset)' };
  if (!defaultPreset) return { origin: 'default' };
  try {
    return { preset: findPreset(defaultPreset), origin: 'settings (defaultPreset)' };
  } catch (error) {
    return { origin: 'settings (defaultPreset)', error: (error as Error).message };
  }
}

export async function settingsExtras(
  store: ResearchSessionStore,
  deps: CliDependencies,
  options: SettingsExtrasOptions = {}
): Promise<SettingsRow[]> {
  const rows: SettingsRow[] = [];
  const settings = resolveStoreSettings(store, deps.env);
  const { preset, origin, error } = activePreset(options.state, settings.values.defaultPreset);
  rows.push({
    key: 'preset',
    value: preset ? preset.name : error ? `(invalid: ${error})` : '(none)',
    origin,
  });
  if (preset?.modelSlots?.length) {
    const { models } = await resolvePresetModels(preset, deps, { store, settings });
    for (const slot of preset.modelSlots) {
      const model = models[slot.key];
      if (!model) continue;
      rows.push({
        key: `model.${slot.key}`,
        value: model.contextWindowTokens
          ? `${model.id} (${Math.round(model.contextWindowTokens / 1000)}k tokens)`
          : model.id,
        origin: describeModelOrigin(model),
      });
    }
  }
  if (options.state) {
    const { state } = options;
    rows.push({ key: 'shell.repo', value: state.repoRoot, origin: 'shell (/repo)' });
    rows.push({
      key: 'shell.session',
      value: state.selectedSession ?? '(none)',
      origin: 'shell (/use)',
    });
    rows.push({
      key: 'shell.ducks',
      value: describeSelection(state.selection) ?? 'auto',
      origin: 'shell (/duck)',
    });
    const items = basketSize(state.basket);
    rows.push({
      key: 'shell.context',
      value:
        items === 0
          ? '(empty)'
          : `${items} item${items === 1 ? '' : 's'}${state.basket.markdownOnly ? ', Markdown only' : ''}`,
      origin: 'shell (/context)',
    });
  }
  if (options.providers) {
    const listed = await withCouncilRuntime(deps.runtimeFactory(store), ({ gateway }) =>
      gateway.listProviders(store.sessionDirectory('chat'))
    );
    if (listed.length === 0) {
      rows.push({ key: 'provider', value: '(none configured)', origin: 'rubber duck' });
    }
    for (const provider of listed) {
      rows.push({
        key: `provider.${provider.name}`,
        value: `${provider.model} (${provider.type})`,
        origin: 'rubber duck',
      });
    }
  }
  return rows;
}
