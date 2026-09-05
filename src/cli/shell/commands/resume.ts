import type { ResearchSession } from '../../../research/types.js';
import { withCouncilRuntime } from '../../../runtime.js';
import { runSummaryText } from '../../format.js';
import { proposalStatusText, proposalSummaryText } from '../../propose.js';
import { proposalSelected, selectedProposalId } from '../proposal-scope.js';
import type { ShellCommand } from '../registry.js';

export const resumeCommand: ShellCommand = {
  name: 'resume',
  usage: '/resume',
  summary: 'Resume from the last durable stage',
  run: async (ctx) => {
    if (proposalSelected(ctx)) {
      const renderer = ctx.createProgressRenderer();
      try {
        const proposal = await withCouncilRuntime(ctx.runtimeFactory(ctx.store), (runtime) =>
          runtime.proposals.resume(selectedProposalId(ctx), renderer.handle, ctx.signal)
        );
        ctx.io.out(
          proposal.proposal ? proposalSummaryText(proposal) : proposalStatusText(proposal)
        );
      } finally {
        renderer.finish();
      }
      return;
    }
    const renderer = ctx.createProgressRenderer();
    const startedAt = ctx.now();
    let session: ResearchSession;
    try {
      session = await withCouncilRuntime(ctx.runtimeFactory(ctx.store), ({ service }) =>
        service.resume(ctx.state.selectedSession, renderer.handle, ctx.signal)
      );
    } finally {
      renderer.finish();
    }
    ctx.state.selectedSession = session.id;
    ctx.io.out(runSummaryText(session, { elapsedMs: ctx.now() - startedAt }));
  },
};
