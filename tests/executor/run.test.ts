import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runExecutor } from '../../src/executor/run.js';
import type { ExecutorLaunch } from '../../src/executor/types.js';
import { EXECUTOR_REPORT_BEGIN, EXECUTOR_REPORT_END } from '../../src/research/proposal/prompts.js';

const REPORT_SCRIPT = `
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  console.log('working...');
  console.error('note from stderr');
  console.log('${EXECUTOR_REPORT_BEGIN}');
  console.log('## Summary');
  console.log('Got: ' + input.split('\\n')[0]);
  console.log('${EXECUTOR_REPORT_END}');
  console.log('trailing chatter');
});
`;

const PROMPT_FILE_SCRIPT = `
const fs = require('fs');
const index = process.argv.indexOf('--prompt-file');
const file = process.argv[index + 1];
const text = fs.readFileSync(file, 'utf8');
console.log('${EXECUTOR_REPORT_BEGIN}');
console.log('file: ' + require('path').basename(file));
console.log('text: ' + text);
console.log('${EXECUTOR_REPORT_END}');
`;

const FAIL_SCRIPT = `console.log('boom'); process.exit(3);`;
const SILENT_SCRIPT = `console.log('done without report');`;
const HANG_SCRIPT = `console.log('started'); setInterval(() => {}, 1000);`;

function script(directory: string, name: string, source: string): string {
  const path = join(directory, name);
  writeFileSync(path, source, 'utf8');
  return path;
}

function launchFor(path: string, promptDelivery: ExecutorLaunch['promptDelivery'] = 'stdin') {
  return {
    profile: 'fake',
    command: process.execPath,
    args: [path],
    promptDelivery,
    mode: 'full-auto',
  } satisfies ExecutorLaunch;
}

describe('runExecutor', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hc-executor-'));

  it('delivers the prompt on stdin, streams lines to the log, and extracts the report', async () => {
    const logPath = join(directory, 'run.log');
    const lines: string[] = [];
    const result = await runExecutor(
      launchFor(script(directory, 'report.cjs', REPORT_SCRIPT)),
      'first line\nsecond',
      {
        cwd: directory,
        logPath,
        onLine: (line, stream) => lines.push(`${stream}:${line}`),
      }
    );
    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
    expect(result.report).toBe('## Summary\nGot: first line');
    expect(result.output).toContain('trailing chatter');
    expect(lines).toContain('stdout:working...');
    expect(lines).toContain('stderr:note from stderr');
    expect(readFileSync(logPath, 'utf8')).toContain('working...');
    expect(readFileSync(logPath, 'utf8')).toContain('note from stderr');
  });

  it('writes a prompt file for prompt-file delivery and removes it afterwards', async () => {
    const result = await runExecutor(
      launchFor(script(directory, 'prompt-file.cjs', PROMPT_FILE_SCRIPT), 'prompt-file'),
      'hello from a file',
      { cwd: directory }
    );
    expect(result.status).toBe('completed');
    expect(result.report).toContain('file: .hc-executor-prompt-');
    expect(result.report).toContain('text: hello from a file');
    expect(
      readdirSync(directory).filter((name) => name.startsWith('.hc-executor-prompt-'))
    ).toEqual([]);
  });

  it('reports failures, missing reports, and unstartable commands', async () => {
    const failed = await runExecutor(launchFor(script(directory, 'fail.cjs', FAIL_SCRIPT)), 'p', {
      cwd: directory,
    });
    expect(failed).toMatchObject({
      status: 'failed',
      exitCode: 3,
      error: 'Executor exited with code 3',
    });
    expect(failed.output).toBe('boom');

    const silent = await runExecutor(
      launchFor(script(directory, 'silent.cjs', SILENT_SCRIPT)),
      'p',
      {
        cwd: directory,
      }
    );
    expect(silent.status).toBe('completed');
    expect(silent.report).toBeUndefined();
    expect(silent.error).toBe('The executor finished without printing a delimited report');

    const missing = await runExecutor(
      { ...launchFor('x'), command: join(directory, 'does-not-exist.exe'), args: [] },
      'p',
      { cwd: directory }
    );
    expect(missing.status).toBe('failed');
    expect(missing.error).toContain('Failed to start');
    expect(existsSync(join(directory, 'does-not-exist.exe'))).toBe(false);
  });

  it('kills the executor on timeout and on abort', async () => {
    const hang = script(directory, 'hang.cjs', HANG_SCRIPT);
    const timedOut = await runExecutor(launchFor(hang), 'p', { cwd: directory, timeoutMs: 300 });
    expect(timedOut.status).toBe('timed-out');
    expect(timedOut.error).toBe('Executor exceeded 300 ms');
    expect(timedOut.output).toContain('started');

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const interrupted = await runExecutor(launchFor(hang), 'p', {
      cwd: directory,
      signal: controller.signal,
    });
    expect(interrupted.status).toBe('interrupted');
    expect(interrupted.error).toBe('Executor interrupted');
  }, 20_000);
});
