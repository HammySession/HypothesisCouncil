import { candidateText, normalizeCandidateId } from '../../format.js';
import type { ShellCommand } from '../registry.js';

export const showCommand: ShellCommand = {
  name: 'show',
  usage: '/show H-001',
  summary: 'Inspect a candidate and its criticism',
  run: (ctx, args) => {
    if (!args) throw new Error('Usage: /show H-001 (H1 and 1 are accepted too)');
    ctx.io.out(
      candidateText(ctx.store.load(ctx.state.selectedSession), normalizeCandidateId(args))
    );
    return Promise.resolve();
  },
};
