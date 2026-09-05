import { parseArguments } from '../../arguments.js';
import { executeDoctor } from '../../doctor-command.js';
import { doctorText } from '../../doctor.js';
import type { ShellCommand } from '../registry.js';
import { splitShellArguments } from '../tokenize.js';

export const doctorCommand: ShellCommand = {
  name: 'doctor',
  usage: '/doctor [--probe] [--preset NAME]',
  summary: 'Check provider configuration',
  run: async (ctx, args) => {
    const parsed = parseArguments(splitShellArguments(args));
    const { report, preset } = await executeDoctor(parsed, ctx.store, ctx, ctx.signal);
    ctx.io.out(`${preset ? `Preset: ${preset.name}\n` : ''}${doctorText(report)}`);
  },
};
