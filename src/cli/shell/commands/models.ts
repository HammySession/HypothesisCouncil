import { parseArguments } from '../../arguments.js';
import { executeModels } from '../../models-command.js';
import type { ShellCommand } from '../registry.js';
import { splitShellArguments } from '../tokenize.js';

export const modelsCommand: ShellCommand = {
  name: 'models',
  usage: '/models [refresh] [--preset NAME] [--json]',
  summary: 'Show which model each preset slot resolves to and where the choice came from',
  run: async (ctx, args) => {
    const words = splitShellArguments(args).map((word) =>
      word === 'refresh' ? '--refresh' : word
    );
    const parsed = parseArguments(words);
    if (!parsed.flags.has('--preset') && ctx.state.preset) {
      parsed.flags.set('--preset', [ctx.state.preset.name]);
    }
    await executeModels(parsed, ctx.store, ctx);
  },
};
