import { executeSettings } from '../../settings-command.js';
import { settingsExtras } from '../../settings-extras.js';
import type { ShellCommand } from '../registry.js';

export const settingsCommand: ShellCommand = {
  name: 'settings',
  usage: '/settings [json] [providers] | help',
  summary:
    'Show effective settings, preset models, and shell state; "providers" lists the ducks too',
  run: async (ctx, args) => {
    const words = args
      .split(/\s+/)
      .map((word) => word.replace(/^--/, ''))
      .filter(Boolean);
    if (words.includes('help')) {
      executeSettings({ kind: 'help' }, ctx.store, ctx);
      return;
    }
    const unknown = words.filter((word) => word !== 'json' && word !== 'providers');
    if (unknown.length > 0) throw new Error('Usage: /settings [json] [providers] | help');
    const extras = await settingsExtras(ctx.store, ctx, {
      state: ctx.state,
      providers: words.includes('providers'),
    });
    executeSettings({ kind: 'show', json: words.includes('json') }, ctx.store, ctx, extras);
  },
};
