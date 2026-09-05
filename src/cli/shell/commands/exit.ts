import type { ShellCommand } from '../registry.js';

export const exitCommand: ShellCommand = {
  name: 'exit',
  aliases: ['quit'],
  usage: '/exit',
  summary: 'Exit (an active run is interrupted and checkpointed)',
  run: (ctx) => {
    ctx.state.closing = true;
    return Promise.resolve();
  },
};
