import { isProposalId } from '../../../research/proposal/store.js';
import { proposalStore } from '../proposal-scope.js';
import type { ShellCommand } from '../registry.js';

export const useCommand: ShellCommand = {
  name: 'use',
  usage: '/use SESSION',
  summary: 'Select a persisted council session (RC-...) or research proposal (RP-...)',
  run: (ctx, args) => {
    if (!args) throw new Error('Usage: /use SESSION (run /sessions or /proposals to list them)');
    ctx.state.selectedSession = isProposalId(args)
      ? proposalStore(ctx).use(args).id
      : ctx.store.use(args).id;
    ctx.state.chats.clear();
    ctx.io.out(`Using ${ctx.state.selectedSession}`);
    return Promise.resolve();
  },
};
