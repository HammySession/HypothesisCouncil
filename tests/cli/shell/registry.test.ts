import {
  dispatchShellLine,
  findShellCommand,
  parseShellLine,
  type ShellCommand,
} from '../../../src/cli/shell/registry.js';
import { SHELL_COMMANDS } from '../../../src/cli/shell/commands/index.js';
import { shellHelpText } from '../../../src/cli/shell/help.js';
import { createTestContext } from './fakes.js';

describe('shell registry', () => {
  it('parses command lines and plain text', () => {
    expect(parseShellLine('   ')).toBeUndefined();
    expect(parseShellLine('/show  H-1 ')).toEqual({ command: 'show', args: 'H-1' });
    expect(parseShellLine('/status')).toEqual({ command: 'status', args: '' });
    expect(parseShellLine('what is going on')).toEqual({ args: 'what is going on' });
  });

  it('routes to commands by name or alias, and plain text to chat', async () => {
    const calls: string[] = [];
    const commands: ShellCommand[] = [
      {
        name: 'ping',
        aliases: ['p'],
        usage: '/ping',
        summary: 'Ping',
        run: (_ctx, args) => {
          calls.push(`ping:${args}`);
          return Promise.resolve();
        },
      },
    ];
    const ctx = createTestContext();
    const chat = (_ctx: unknown, text: string) => {
      calls.push(`chat:${text}`);
      return Promise.resolve();
    };

    await dispatchShellLine(ctx, '/ping one two', commands, chat);
    await dispatchShellLine(ctx, '/p', commands, chat);
    await dispatchShellLine(ctx, 'hello there', commands, chat);
    await dispatchShellLine(ctx, '', commands, chat);

    expect(calls).toEqual(['ping:one two', 'ping:', 'chat:hello there']);
    await expect(dispatchShellLine(ctx, '/nope now', commands, chat)).rejects.toThrow(
      'Unknown interactive command: /nope now'
    );
  });

  it('registers every documented command with a unique name and alias', () => {
    const names = SHELL_COMMANDS.flatMap((command) => [command.name, ...(command.aliases ?? [])]);
    expect(new Set(names).size).toBe(names.length);
    for (const name of [
      'run',
      'preset',
      'presets',
      'doctor',
      'status',
      'candidates',
      'show',
      'use',
      'duck',
      'resume',
      'report',
      'sessions',
      'help',
      'exit',
    ]) {
      expect(findShellCommand(name)?.name).toBe(name);
    }
    expect(findShellCommand('quit')?.name).toBe('exit');

    const help = shellHelpText(SHELL_COMMANDS);
    expect(help).toContain('/run [goal] [flags]');
    expect(help).toContain('/report [html]');
    expect(help).toContain('Plain text asks the selected duck a question.');
  });
});
