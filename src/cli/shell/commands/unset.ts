import { currentDials, executeSettings } from '../../settings-command.js';
import type { ShellCommand } from '../registry.js';
import { splitShellArguments } from '../tokenize.js';

export const unsetCommand: ShellCommand = {
  name: 'unset',
  usage: '/unset KEY',
  summary: 'Remove a setting from the settings file',
  run: (ctx, args) => {
    const words = splitShellArguments(args);
    if (words.length !== 1) throw new Error('Usage: /unset KEY');
    executeSettings({ kind: 'unset', key: words[0] }, ctx.store, ctx);
    ctx.state.dials = currentDials(ctx.store, ctx.env);
    return Promise.resolve();
  },
};
