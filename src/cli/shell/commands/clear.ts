import type { ShellCommand } from '../registry.js';

export const clearCommand: ShellCommand = {
  name: 'clear',
  usage: '/clear [PROVIDER]',
  summary: 'Forget the chat history of every duck (or one)',
  run: (ctx, args) => {
    const name = args.trim();
    if (name) {
      ctx.state.chats.delete(name);
      ctx.io.out(`Cleared the chat history of ${name}`);
    } else {
      ctx.state.chats.clear();
      ctx.io.out('Cleared all chat histories');
    }
    return Promise.resolve();
  },
};
