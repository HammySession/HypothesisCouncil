import { candidatesText } from '../../format.js';
import type { ShellCommand } from '../registry.js';

export const candidatesCommand: ShellCommand = {
  name: 'candidates',
  usage: '/candidates',
  summary: 'List visible candidates',
  run: (ctx) => {
    ctx.io.out(candidatesText(ctx.store.load(ctx.state.selectedSession)));
    return Promise.resolve();
  },
};
