import { withCouncilRuntime } from '../../../runtime.js';
import { buildSummaryPrompt, normalizeSummary } from '../../reports/summary-prompt.js';
import { resolveProviderSelection } from '../providers.js';
import type { ShellCommand } from '../registry.js';

export const summarizeCommand: ShellCommand = {
  name: 'summarize',
  aliases: ['summarise'],
  usage: '/summarize [SESSION]',
  summary: 'Ask one duck for a two-sentence catalog summary of a report and save it',
  run: async (ctx, args) => {
    const session = ctx.store.load(args.trim() || ctx.state.selectedSession);
    if (session.candidates.length === 0) {
      throw new Error(`Session ${session.id} has no candidates to summarise yet`);
    }
    const available = session.providers.map((name) => ({ name }));
    const provider = resolveProviderSelection(
      ctx.state.selection,
      available,
      session.providers[0]
    )[0];
    const summary = await withCouncilRuntime(ctx.runtimeFactory(ctx.store), async ({ gateway }) => {
      const completion = await gateway.complete(provider, buildSummaryPrompt(session), {
        workingDirectory: ctx.store.sessionDirectory(session.id),
        signal: ctx.signal,
      });
      return normalizeSummary(completion.content);
    });
    if (!summary) throw new Error('The duck returned an empty summary; nothing was saved');
    ctx.store.updateMeta(session.id, { summary });
    ctx.io.out(summary);
  },
};
