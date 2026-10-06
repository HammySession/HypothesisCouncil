import {
  NO_PROVIDER_CLI_MESSAGE,
  applyPreset,
  describeModels,
  findPreset,
  missingPresetCommands,
} from '../../presets.js';
import { resolvePresetModels } from '../../preset-selection.js';
import { resolveStoreSettings } from '../../settings-command.js';
import type { ShellCommand } from '../registry.js';

export const presetCommand: ShellCommand = {
  name: 'preset',
  usage: '/preset NAME',
  summary: 'Use a council preset for later /run commands',
  run: async (ctx, args) => {
    if (!args) throw new Error('Usage: /preset NAME (run /presets to list them)');
    const preset = findPreset(args, ctx.locateCommand);
    if (preset.requiredCommands.length === 0 && preset.providers.length === 0) {
      throw new Error(NO_PROVIDER_CLI_MESSAGE);
    }
    const missing = missingPresetCommands(preset, ctx.env, ctx.platform, ctx.locateCommand);
    if (missing.length > 0) {
      throw new Error(`Preset ${preset.name} needs these commands on PATH: ${missing.join(', ')}`);
    }
    const settings = resolveStoreSettings(ctx.store, ctx.env);
    const { models } = await resolvePresetModels(preset, ctx, { store: ctx.store, settings });
    applyPreset(preset, ctx.env, { models, snapshot: ctx.envSnapshot });
    ctx.state.preset = preset;
    const summary = describeModels(preset, models);
    ctx.io.out(
      `Preset ${preset.name}: ${preset.providers.join(', ')}${summary ? ` · models: ${summary}` : ''}`
    );
  },
};
