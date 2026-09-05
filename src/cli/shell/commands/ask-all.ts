import { chatFallback } from '../chat.js';
import type { ShellCommand } from '../registry.js';

export const askAllCommand: ShellCommand = {
  name: 'ask-all',
  usage: '/ask-all QUESTION',
  summary: 'Ask every available duck the same question once, replies labelled per duck',
  run: async (ctx, args) => {
    if (!args.trim()) throw new Error('Usage: /ask-all QUESTION');
    const previous = ctx.state.selection;
    ctx.state.selection = { kind: 'all' };
    try {
      await chatFallback(ctx, args);
    } finally {
      ctx.state.selection = previous;
    }
  },
};
