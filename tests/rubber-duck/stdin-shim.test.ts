import { mkdtempSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Writable } from 'stream';
import {
  parseAgyStreamResult,
  parseStdinShimArguments,
  runStdinShim,
} from '../../src/rubber-duck/stdin-shim-core.js';

class Collector extends Writable {
  text = '';

  override _write(chunk: Buffer, _encoding: string, callback: () => void): void {
    this.text += chunk.toString('utf8');
    callback();
  }
}

const FAKE_PROMPT_FILE_CLI = `import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
const index = process.argv.indexOf('--prompt-file');
const path = process.argv[index + 1];
process.stdout.write(JSON.stringify({
  args: process.argv.slice(2, index),
  prompt: readFileSync(path, 'utf8'),
  inWorkingDirectory: dirname(path) === process.env.SHIM_TEST_CWD,
  hidden: basename(path).startsWith('.hc-prompt-'),
}));
`;

const FAKE_AGY_CLI = `let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  const message = JSON.parse(input.trim());
  const args = process.argv.slice(2);
  const ok =
    message.event === 'user' &&
    message.message.role === 'user' &&
    args.includes('--input-format') &&
    args.includes('--print') &&
    args.includes('--model');
  if (!ok) {
    process.stderr.write('bad input');
    process.exit(3);
  }
  process.stdout.write(JSON.stringify({ event: 'init', init: { model: 'x' } }) + '\\n');
  process.stdout.write('warning: not json\\n');
  const status = process.env.FAKE_AGY_STATUS || 'SUCCESS';
  const result = status === 'SUCCESS'
    ? { status, response: 'echo: ' + message.message.content }
    : { status, response: '', error: 'quota exhausted' };
  process.stdout.write(JSON.stringify({ event: 'result', result }) + '\\n');
});
`;

describe('stdin shim', () => {
  it('parses its invocation', () => {
    expect(parseStdinShimArguments(['prompt-file', '--', 'grok', '-m', 'grok-4.6'])).toEqual({
      mode: 'prompt-file',
      command: 'grok',
      args: ['-m', 'grok-4.6'],
    });
    expect(() => parseStdinShimArguments(['nope', '--', 'grok'])).toThrow('Usage');
    expect(() => parseStdinShimArguments(['prompt-file', 'grok'])).toThrow('Usage');
  });

  it('hands the prompt to a prompt-file CLI through a private temporary file', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'hc-shim-file-'));
    const fake = join(cwd, 'fake-grok.mjs');
    writeFileSync(fake, FAKE_PROMPT_FILE_CLI, 'utf8');
    const stdout = new Collector();
    const stderr = new Collector();

    const code = await runStdinShim(
      { mode: 'prompt-file', command: process.execPath, args: [fake, '-m', 'grok-4.6'] },
      'council prompt',
      { cwd, stdout, stderr, env: { ...process.env, SHIM_TEST_CWD: cwd } }
    );

    expect(code).toBe(0);
    expect(JSON.parse(stdout.text)).toEqual({
      args: ['-m', 'grok-4.6'],
      prompt: 'council prompt',
      inWorkingDirectory: true,
      hidden: true,
    });
    expect(readdirSync(cwd).filter((name) => name.startsWith('.hc-prompt-'))).toEqual([]);
  });

  it('streams the prompt to AGY as stream-json and prints only the final response', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'hc-shim-agy-'));
    const fake = join(cwd, 'fake-agy.mjs');
    writeFileSync(fake, FAKE_AGY_CLI, 'utf8');
    const invocation = {
      mode: 'agy-stream-json' as const,
      command: process.execPath,
      args: [fake, '--model', 'gemini'],
    };
    const stdout = new Collector();
    const stderr = new Collector();

    const code = await runStdinShim(invocation, 'hello council', {
      cwd,
      stdout,
      stderr,
      env: process.env,
    });
    expect(code).toBe(0);
    expect(stdout.text).toBe('echo: hello council');

    const failedOut = new Collector();
    const failedErr = new Collector();
    const failedCode = await runStdinShim(invocation, 'hello', {
      cwd,
      stdout: failedOut,
      stderr: failedErr,
      env: { ...process.env, FAKE_AGY_STATUS: 'ERROR' },
    });
    expect(failedCode).toBe(1);
    expect(failedOut.text).toBe('');
    expect(failedErr.text).toContain('quota exhausted');
  });

  it('fails when the wrapped command produces no result event', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'hc-shim-empty-'));
    const fake = join(cwd, 'silent.mjs');
    writeFileSync(fake, "process.stdin.resume(); process.stdin.on('end', () => {});\n", 'utf8');
    const stderr = new Collector();

    const code = await runStdinShim(
      { mode: 'agy-stream-json', command: process.execPath, args: [fake] },
      'hello',
      { cwd, stdout: new Collector(), stderr, env: process.env }
    );

    expect(code).toBe(1);
    expect(stderr.text).toContain('no stream-json result');
  });

  it('reports a command that cannot start and still removes the prompt file', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'hc-shim-missing-'));

    await expect(
      runStdinShim({ mode: 'prompt-file', command: join(cwd, 'missing-cli'), args: [] }, 'hello', {
        cwd,
        stdout: new Collector(),
        stderr: new Collector(),
        env: process.env,
      })
    ).rejects.toThrow('Failed to start');
    expect(readdirSync(cwd)).toEqual([]);
  });

  it('parses the last stream-json result event', () => {
    expect(
      parseAgyStreamResult(
        '{"event":"init"}\nnoise\n{"event":"result","result":{"status":"ERROR"}}\n{"event":"result","result":{"status":"SUCCESS","response":"ok"}}\n'
      )
    ).toEqual({ status: 'SUCCESS', response: 'ok' });
    expect(parseAgyStreamResult('nothing here')).toBeUndefined();
  });
});
