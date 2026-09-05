import {
  DEFAULT_EXECUTOR_TIMEOUT_MS,
  customExecutorVariables,
  describeExecutorLaunch,
  executorMode,
  executorTimeoutMs,
  resolveExecutorLaunch,
} from '../../src/executor/profiles.js';

describe('executor profiles', () => {
  const base = {
    env: {},
    execPath: '/usr/bin/node',
    shimPath: '/hc/stdin-shim.js',
    platform: 'linux' as const,
  };

  it('runs the built-in executors in full-auto mode by default', () => {
    const claude = resolveExecutorLaunch('claude', { ...base, model: 'claude-x' });
    expect(claude).toMatchObject({
      profile: 'claude',
      command: 'claude',
      promptDelivery: 'stdin',
      mode: 'full-auto',
      shell: false,
    });
    expect(claude.args).toEqual([
      '-p',
      '--output-format',
      'text',
      '--dangerously-skip-permissions',
      '--max-turns',
      '400',
      '--model',
      'claude-x',
    ]);
    expect(resolveExecutorLaunch('codex', base).args).toEqual([
      'exec',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '-',
    ]);
    const agy = resolveExecutorLaunch('agy', { ...base, model: 'gemini-3.8-flash' });
    expect(agy.command).toBe('/usr/bin/node');
    expect(agy.args).toEqual([
      '/hc/stdin-shim.js',
      'agy-stream-json',
      '--',
      'agy',
      '--model',
      'gemini-3.8-flash',
      '--effort',
      'high',
      '--yolo',
    ]);
    expect(resolveExecutorLaunch('grok', base).args).toEqual([
      '/hc/stdin-shim.js',
      'prompt-file',
      '--',
      'grok',
      '--reasoning-effort',
      'high',
    ]);
  });

  it('honours the sandboxed mode from the environment or an override', () => {
    const env = { HYPOTHESIS_COUNCIL_EXECUTOR_MODE: 'sandboxed' };
    expect(resolveExecutorLaunch('claude', { ...base, env }).args).toContain('acceptEdits');
    expect(resolveExecutorLaunch('codex', { ...base, env }).args).toContain('--full-auto');
    expect(resolveExecutorLaunch('agy', { ...base, mode: 'sandboxed' }).args).toContain(
      '--sandbox'
    );
    expect(() => executorMode({ HYPOTHESIS_COUNCIL_EXECUTOR_MODE: 'yolo' })).toThrow(
      'must be full-auto or sandboxed'
    );
  });

  it('reads custom executors from the environment and lets them override built-ins', () => {
    const variables = customExecutorVariables('nightly-run');
    expect(variables.command).toBe('HYPOTHESIS_COUNCIL_EXECUTOR_NIGHTLY_RUN_COMMAND');
    const env = {
      [variables.command]: '/opt/agent',
      [variables.args]: 'run, --quiet',
      [variables.promptDelivery]: 'prompt-file',
      [variables.modelFlag]: '--model',
    };
    expect(resolveExecutorLaunch('nightly-run', { ...base, env, model: 'm1' })).toMatchObject({
      profile: 'nightly-run',
      command: '/opt/agent',
      args: ['run', '--quiet', '--model', 'm1'],
      promptDelivery: 'prompt-file',
      shell: false,
    });
    expect(
      resolveExecutorLaunch('claude', {
        ...base,
        env: { HYPOTHESIS_COUNCIL_EXECUTOR_CLAUDE_COMMAND: 'my-claude' },
      }).command
    ).toBe('my-claude');
    expect(() =>
      resolveExecutorLaunch('x', {
        ...base,
        env: {
          HYPOTHESIS_COUNCIL_EXECUTOR_X_COMMAND: 'x',
          HYPOTHESIS_COUNCIL_EXECUTOR_X_PROMPT_DELIVERY: 'pipe',
        },
      })
    ).toThrow('must be stdin, argument, or prompt-file');
  });

  it('rejects unknown executors and uses a shell only for bare commands on Windows', () => {
    expect(() => resolveExecutorLaunch('mystery', base)).toThrow(
      'Unknown executor: mystery. Use claude, codex, agy, grok, or define HYPOTHESIS_COUNCIL_EXECUTOR_MYSTERY_COMMAND.'
    );
    expect(resolveExecutorLaunch('claude', { ...base, platform: 'win32' }).shell).toBe(true);
    expect(resolveExecutorLaunch('agy', { ...base, platform: 'win32' }).shell).toBeUndefined();
    expect(
      resolveExecutorLaunch('tool', {
        ...base,
        platform: 'win32',
        env: { HYPOTHESIS_COUNCIL_EXECUTOR_TOOL_COMMAND: 'C:\\tools\\agent.exe' },
      }).shell
    ).toBe(false);
  });

  it('resolves timeouts and describes a launch', () => {
    expect(executorTimeoutMs({})).toBe(DEFAULT_EXECUTOR_TIMEOUT_MS);
    expect(executorTimeoutMs({ HYPOTHESIS_COUNCIL_EXECUTOR_TIMEOUT_MS: '5000' })).toBe(5000);
    expect(executorTimeoutMs({}, 250)).toBe(250);
    expect(() => executorTimeoutMs({ HYPOTHESIS_COUNCIL_EXECUTOR_TIMEOUT_MS: '-1' })).toThrow(
      'positive number'
    );
    expect(describeExecutorLaunch(resolveExecutorLaunch('codex', { ...base, model: 'gpt' }))).toBe(
      'codex (full-auto · model gpt): codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --model gpt -'
    );
  });
});
