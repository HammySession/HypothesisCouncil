import { parseArguments } from '../../arguments.js';
import { runSummaryText } from '../../format.js';
import { runCommand } from '../../run-command.js';
import type { ShellCommand } from '../registry.js';
import { applyRunDefaults, runDefaultsFromState } from '../run-defaults.js';
import { splitShellArguments } from '../tokenize.js';

export const runShellCommand: ShellCommand = {
  name: 'run',
  usage: '/run [goal] [flags]',
  summary:
    'Start a foreground council run for the current repository with the context basket (accepts hc run flags)',
  run: async (ctx, args) => {
    const parsed = applyRunDefaults(
      parseArguments(splitShellArguments(args)),
      runDefaultsFromState(ctx.state)
    );
    const outcome = await runCommand(parsed, ctx.store, ctx, {
      interactive: true,
      signal: ctx.signal,
      preset: ctx.state.preset,
    });
    if (!outcome) return;
    ctx.state.selectedSession = outcome.session.id;
    ctx.state.chats.clear();
    ctx.io.out(runSummaryText(outcome.session, { elapsedMs: outcome.elapsedMs }));
  },
};
