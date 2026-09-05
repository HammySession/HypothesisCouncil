import { describeSelection } from '../context.js';
import { parseSelection } from '../providers.js';
import type { ShellCommand } from '../registry.js';

export const duckCommand: ShellCommand = {
  name: 'duck',
  usage: '/duck NAME[,NAME] | all | auto',
  summary: 'Choose which ducks answer plain text (several names get labelled replies)',
  run: (ctx, args) => {
    const known = ctx.state.knownProviders.map((name) => ({ name }));
    if (!args.trim()) {
      ctx.io.out(`Conversational ducks: ${describeSelection(ctx.state.selection) ?? 'auto'}`);
      return Promise.resolve();
    }
    const selection = parseSelection(args, known);
    ctx.state.selection = selection;
    if (selection.kind === 'named') {
      for (const name of selection.names) ctx.state.chats.delete(name);
    }
    ctx.io.out(`Conversational ducks: ${describeSelection(selection) ?? 'auto'}`);
    return Promise.resolve();
  },
};
