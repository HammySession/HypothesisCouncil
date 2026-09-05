import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import type { ShellCommand } from '../registry.js';

export const repoCommand: ShellCommand = {
  name: 'repo',
  usage: '/repo [PATH]',
  summary: 'Show or change the repository root used by /run and the context basket',
  run: (ctx, args) => {
    const target = args.trim();
    if (!target) {
      ctx.io.out(`Repository root: ${ctx.state.repoRoot}`);
      return Promise.resolve();
    }
    const path = resolve(ctx.state.repoRoot, target);
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      throw new Error(`Not a directory: ${path}`);
    }
    ctx.state.repoRoot = path;
    ctx.state.confirmedPackets.clear();
    ctx.io.out(`Repository root: ${path}`);
    return Promise.resolve();
  },
};
