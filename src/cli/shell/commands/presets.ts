import { presetsText } from '../../presets.js';
import type { ShellCommand } from '../registry.js';

export const presetsCommand: ShellCommand = {
  name: 'presets',
  usage: '/presets',
  summary: 'List ready-made council presets',
  run: (ctx) => {
    ctx.io.out(presetsText());
    return Promise.resolve();
  },
};
