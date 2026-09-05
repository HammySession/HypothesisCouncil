import { sessionsText } from '../../format.js';
import type { ShellCommand } from '../registry.js';

export const sessionsCommand: ShellCommand = {
  name: 'sessions',
  usage: '/sessions',
  summary: 'List sessions',
  run: (ctx) => {
    ctx.io.out(sessionsText(ctx.store.list()));
    return Promise.resolve();
  },
};
