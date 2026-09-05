import type { ShellCommand } from './registry.js';

export const CHAT_HELP =
  'Plain text asks the selected duck a question. When a session is selected, answers are grounded in its persisted candidates and do not mutate rankings.';

/** The interactive command list, generated from each command's usage and summary. */
export function shellHelpText(commands: readonly ShellCommand[]): string {
  const width = Math.max(...commands.map((command) => command.usage.length));
  return [
    'Interactive commands:',
    ...commands.map((command) => `  ${command.usage.padEnd(width)}  ${command.summary}`),
    '',
    CHAT_HELP,
  ].join('\n');
}
