import { statusText } from '../../format.js';
import { proposalStatusText } from '../../propose.js';
import { loadSelectedProposal, proposalSelected } from '../proposal-scope.js';
import type { ShellCommand } from '../registry.js';

export const statusCommand: ShellCommand = {
  name: 'status',
  usage: '/status',
  summary: 'View current progress',
  run: (ctx) => {
    if (proposalSelected(ctx)) {
      ctx.io.out(proposalStatusText(loadSelectedProposal(ctx)));
      return Promise.resolve();
    }
    ctx.io.out(statusText(ctx.store.load(ctx.state.selectedSession)));
    return Promise.resolve();
  },
};
