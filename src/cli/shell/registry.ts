import { chatFallback } from './chat.js';
import { SHELL_COMMANDS } from './commands/index.js';
import type { ShellContext } from './context.js';

export interface ShellCommand {
  /** Command name without the leading slash. */
  name: string;
  aliases?: string[];
  /** Shown in `/help`, for example `/show H-001`. */
  usage: string;
  summary: string;
  /** `args` is the rest of the line after the command word, trimmed. */
  run(ctx: ShellContext, args: string): Promise<void>;
}

export interface ParsedShellLine {
  /** Command word without the slash; undefined for plain text. */
  command?: string;
  args: string;
}

export function parseShellLine(line: string): ParsedShellLine | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith('/')) return { args: trimmed };
  const match = trimmed.match(/^\/(\S*)\s*(.*)$/s);
  return { command: match?.[1] ?? '', args: (match?.[2] ?? '').trim() };
}

export function findShellCommand(
  name: string,
  commands: readonly ShellCommand[] = SHELL_COMMANDS
): ShellCommand | undefined {
  return commands.find((command) => command.name === name || command.aliases?.includes(name));
}

export type ChatHandler = (ctx: ShellContext, text: string) => Promise<void>;

/** Route one shell line: `/command args` to its command, anything else to the chat fallback. */
export async function dispatchShellLine(
  ctx: ShellContext,
  line: string,
  commands: readonly ShellCommand[] = SHELL_COMMANDS,
  chat: ChatHandler = chatFallback
): Promise<void> {
  const parsed = parseShellLine(line);
  if (!parsed) return;
  if (parsed.command === undefined) {
    await chat(ctx, parsed.args);
    return;
  }
  const command = findShellCommand(parsed.command, commands);
  if (!command) throw new Error(`Unknown interactive command: ${line.trim()}`);
  await command.run(ctx, parsed.args);
}
