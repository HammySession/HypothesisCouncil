import { currentDials, executeSettings } from '../../settings-command.js';
import { parseSettingsArgs } from '../../settings-view.js';
import type { ShellCommand } from '../registry.js';
import { splitShellArguments } from '../tokenize.js';

export const setCommand: ShellCommand = {
  name: 'set',
  usage: '/set KEY VALUE',
  summary: 'Save a setting to the settings file (for example /set novelty high)',
  run: (ctx, args) => {
    const words = splitShellArguments(args);
    if (words.length === 0) throw new Error('Usage: /set KEY VALUE (run /settings help for keys)');
    const action = parseSettingsArgs(['set', ...words]);
    if (action.kind !== 'set') throw new Error('Usage: /set KEY VALUE');
    executeSettings(action, ctx.store, ctx);
    ctx.state.dials = currentDials(ctx.store, ctx.env);
    return Promise.resolve();
  },
};
