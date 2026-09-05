import { executeTag, TAG_USAGE } from '../../reports-command.js';
import type { ShellCommand } from '../registry.js';
import { splitShellArguments } from '../tokenize.js';

export const tagCommand: ShellCommand = {
  name: 'tag',
  usage: '/tag [SESSION] add a,b | rm a | title "…" | clear | show',
  summary: 'Tag or retitle a report for the catalog',
  run: (ctx, args) => {
    const words = splitShellArguments(args);
    if (words.length === 0 && !ctx.state.selectedSession) throw new Error(TAG_USAGE);
    executeTag(words, ctx.store, ctx.io, ctx.state.selectedSession);
    return Promise.resolve();
  },
};
