import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { appendFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { extractExecutorReport } from '../research/proposal/prompts.js';
import type {
  ExecutorLaunch,
  ExecutorResult,
  ExecutorRunOptions,
  ExecutorStatus,
} from './types.js';

/** Kill the executor and everything it started; vendor CLIs spawn their own tool processes. */
function killTree(child: ChildProcess, platform: NodeJS.Platform): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('error', () => child.kill());
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  const escalate = setTimeout(() => {
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }, 5000);
  escalate.unref();
  child.once('close', () => clearTimeout(escalate));
}

function quoteForShell(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

class LineSplitter {
  private buffer = '';

  constructor(private readonly emit: (line: string) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      this.emit(this.buffer.slice(0, index).replace(/\r$/, ''));
      this.buffer = this.buffer.slice(index + 1);
      index = this.buffer.indexOf('\n');
    }
  }

  flush(): void {
    if (this.buffer) this.emit(this.buffer);
    this.buffer = '';
  }
}

/**
 * Run an executor once with the prompt delivered the way its profile needs, streaming every
 * output line to the log and the caller. The process tree is killed on abort or timeout.
 */
export function runExecutor(
  launch: ExecutorLaunch,
  prompt: string,
  options: ExecutorRunOptions
): Promise<ExecutorResult> {
  const platform = process.platform;
  const startedAt = Date.now();
  const args = [...launch.args];
  let promptFile: string | undefined;
  if (launch.promptDelivery === 'prompt-file') {
    promptFile = join(options.cwd, `.hc-executor-prompt-${randomUUID().slice(0, 8)}.md`);
    writeFileSync(promptFile, prompt, { encoding: 'utf8', mode: 0o600 });
    args.push('--prompt-file', promptFile);
  } else if (launch.promptDelivery === 'argument') {
    args.push(prompt);
  }
  const cleanup = () => {
    if (!promptFile) return;
    try {
      unlinkSync(promptFile);
    } catch {
      // Already removed by the executor; nothing else to clean up.
    }
  };

  return new Promise((resolve) => {
    const log = (line: string, stream: 'stdout' | 'stderr') => {
      if (options.logPath)
        appendFileSync(options.logPath, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
      options.onLine?.(line, stream);
    };
    const output: string[] = [];
    const stdoutLines = new LineSplitter((line) => {
      output.push(line);
      log(line, 'stdout');
    });
    const stderrLines = new LineSplitter((line) => log(line, 'stderr'));
    let status: ExecutorStatus | undefined;
    let error: string | undefined;
    let settled = false;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      stdoutLines.flush();
      stderrLines.flush();
      const text = output.join('\n');
      const report = extractExecutorReport(text);
      const finalStatus: ExecutorStatus = status ?? (exitCode === 0 ? 'completed' : 'failed');
      resolve({
        status: finalStatus,
        exitCode,
        report,
        output: text,
        durationMs: Date.now() - startedAt,
        error:
          error ??
          (finalStatus === 'failed'
            ? `Executor exited with code ${exitCode ?? 'unknown'}`
            : finalStatus === 'completed' && !report
              ? 'The executor finished without printing a delimited report'
              : undefined),
      });
    };

    let child: ChildProcess;
    try {
      child = spawn(
        launch.shell ? quoteForShell(launch.command) : launch.command,
        launch.shell ? args.map(quoteForShell) : args,
        {
          cwd: options.cwd,
          env: options.env ?? process.env,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: launch.shell === true,
          detached: platform !== 'win32',
          windowsHide: true,
        }
      );
    } catch (spawnError) {
      status = 'failed';
      error = `Failed to start "${launch.command}": ${spawnError instanceof Error ? spawnError.message : String(spawnError)}`;
      finish(null);
      return;
    }

    const timer =
      options.timeoutMs !== undefined
        ? setTimeout(() => {
            status = 'timed-out';
            error = `Executor exceeded ${options.timeoutMs} ms`;
            killTree(child, platform);
          }, options.timeoutMs)
        : undefined;
    const onAbort = () => {
      status = 'interrupted';
      error = 'Executor interrupted';
      killTree(child, platform);
    };
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => stdoutLines.push(chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => stderrLines.push(chunk.toString('utf8')));
    child.on('error', (spawnError) => {
      status = status ?? 'failed';
      error = error ?? `Failed to start "${launch.command}": ${spawnError.message}`;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      finish(null);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      finish(code);
    });
    child.stdin?.on('error', () => undefined);
    if (launch.promptDelivery === 'stdin') child.stdin?.end(prompt);
    else child.stdin?.end();
  });
}
