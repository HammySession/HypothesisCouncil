import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Writable } from 'stream';

/**
 * Vendor CLIs that only accept the prompt as a command-line argument are capped by the operating
 * system's argument length (about 24 KiB on Windows). Rubber Duck can deliver a prompt through
 * stdin, so this shim sits between Rubber Duck and such a CLI: it reads the prompt from stdin and
 * hands it to the vendor CLI through a transport that CLI does support.
 *
 * - `prompt-file`: writes the prompt to a temporary file in the working directory and appends
 *   `--prompt-file PATH` (Grok).
 * - `agy-stream-json`: streams the prompt to Google Antigravity as a `stream-json` user message
 *   and prints the final `result.response` as plain text.
 */
export type StdinShimMode = 'prompt-file' | 'agy-stream-json';

export const STDIN_SHIM_MODES: readonly StdinShimMode[] = ['prompt-file', 'agy-stream-json'];

export interface StdinShimInvocation {
  mode: StdinShimMode;
  command: string;
  args: string[];
}

export interface StdinShimIo {
  cwd: string;
  stdout: Writable;
  stderr: Writable;
  env?: NodeJS.ProcessEnv;
}

function isMode(value: string | undefined): value is StdinShimMode {
  return STDIN_SHIM_MODES.includes(value as StdinShimMode);
}

export function parseStdinShimArguments(argv: string[]): StdinShimInvocation {
  const [mode, separator, command, ...args] = argv;
  if (!isMode(mode) || separator !== '--' || !command) {
    throw new Error(`Usage: stdin-shim <${STDIN_SHIM_MODES.join('|')}> -- <command> [args...]`);
  }
  return { mode, command, args };
}

interface ChildResult {
  code: number;
  stdout: string;
}

function runChild(
  command: string,
  args: string[],
  io: StdinShimIo,
  options: { stdin?: string; captureStdout: boolean }
): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: io.cwd,
      env: io.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    const forward = () => child.kill();
    process.once('SIGTERM', forward);
    process.once('SIGINT', forward);
    child.stdout.on('data', (chunk: Buffer) => {
      if (options.captureStdout) stdout += chunk.toString('utf8');
      else io.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => io.stderr.write(chunk));
    child.on('error', (error) => {
      process.off('SIGTERM', forward);
      process.off('SIGINT', forward);
      reject(new Error(`Failed to start "${command}": ${error.message}`));
    });
    child.on('close', (code) => {
      process.off('SIGTERM', forward);
      process.off('SIGINT', forward);
      resolve({ code: code ?? 1, stdout });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.stdin ?? '');
  });
}

async function runPromptFile(
  invocation: StdinShimInvocation,
  prompt: string,
  io: StdinShimIo
): Promise<number> {
  const path = join(io.cwd, `.hc-prompt-${process.pid}-${randomUUID().slice(0, 8)}.txt`);
  writeFileSync(path, prompt, { encoding: 'utf8', mode: 0o600 });
  try {
    const result = await runChild(
      invocation.command,
      [...invocation.args, '--prompt-file', path],
      io,
      { captureStdout: false }
    );
    return result.code;
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // The vendor CLI may already have removed or locked the file; nothing else to clean up.
    }
  }
}

interface AgyResult {
  status?: string;
  response?: string;
  error?: string;
}

export function parseAgyStreamResult(stdout: string): AgyResult | undefined {
  let result: AgyResult | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as { event?: unknown; result?: AgyResult };
      if (parsed.event === 'result' && parsed.result && typeof parsed.result === 'object') {
        result = parsed.result;
      }
    } catch {
      // Progress lines are not guaranteed to be JSON; only the result event matters.
    }
  }
  return result;
}

async function runAgyStreamJson(
  invocation: StdinShimInvocation,
  prompt: string,
  io: StdinShimIo
): Promise<number> {
  const message = JSON.stringify({ event: 'user', message: { role: 'user', content: prompt } });
  const result = await runChild(
    invocation.command,
    [
      ...invocation.args,
      '--print',
      '',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
    ],
    io,
    { stdin: `${message}\n`, captureStdout: true }
  );
  const parsed = parseAgyStreamResult(result.stdout);
  if (!parsed) {
    io.stderr.write(
      `stdin-shim: ${invocation.command} produced no stream-json result (exit ${result.code}).\n${result.stdout.slice(-2000)}`
    );
    return result.code || 1;
  }
  if (parsed.status !== 'SUCCESS' || typeof parsed.response !== 'string') {
    io.stderr.write(
      `stdin-shim: ${invocation.command} returned ${parsed.status || 'an unknown status'}: ${parsed.error || 'no error detail'}\n`
    );
    return 1;
  }
  io.stdout.write(parsed.response);
  return 0;
}

export function runStdinShim(
  invocation: StdinShimInvocation,
  prompt: string,
  io: StdinShimIo
): Promise<number> {
  switch (invocation.mode) {
    case 'prompt-file':
      return runPromptFile(invocation, prompt, io);
    case 'agy-stream-json':
      return runAgyStreamJson(invocation, prompt, io);
  }
}
