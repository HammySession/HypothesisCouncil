import { shellHelpText } from '../help.js';
import type { ShellCommand } from '../registry.js';

export function createHelpCommand(commands: () => readonly ShellCommand[]): ShellCommand {
  return {
    name: 'help',
    aliases: ['?'],
    usage: '/help',
    summary: 'Show commands',
    run: (ctx) => {
      ctx.io.out(shellHelpText(commands()));
      return Promise.resolve();
    },
  };
}
