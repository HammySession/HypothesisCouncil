import { parseArguments } from '../../arguments.js';
import { continueProposal, parseAnswersFile, startProposal } from '../../propose-command.js';
import { proposalStatusText, proposalSummaryText } from '../../propose.js';
import type { ShellCommand } from '../registry.js';
import { applyRunDefaults, runDefaultsFromState } from '../run-defaults.js';
import { splitShellArguments } from '../tokenize.js';

export const proposeCommand: ShellCommand = {
  name: 'propose',
  usage: '/propose "<topic>" [flags]',
  summary:
    'Start a research proposal: the council interviews you, drafts independently, critiques blind, and merges (accepts hc propose flags)',
  run: async (ctx, args) => {
    const parsed = applyRunDefaults(
      parseArguments(splitShellArguments(args)),
      runDefaultsFromState(ctx.state)
    );
    const started = await startProposal(parsed, ctx.store, ctx, {
      interactive: true,
      signal: ctx.signal,
      preset: ctx.state.preset,
    });
    if (!started) return;
    ctx.state.selectedSession = started.id;
    ctx.state.chats.clear();
    const session = await continueProposal(started.id, ctx.store, ctx, {
      signal: ctx.signal,
      answers: parseAnswersFile(parsed, ctx.cwd),
      draft: !parsed.flags.has('--no-draft'),
    });
    ctx.io.out(session.proposal ? proposalSummaryText(session) : proposalStatusText(session));
  },
};
