import { jest } from '@jest/globals';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  definedEnvironment,
  installedRubberDuckVersion,
  resolveRubberDuckLaunch,
  resolveStdinShimPath,
  rubberDuckEnvironment,
} from '../../src/rubber-duck/launch.js';

describe('Rubber Duck launch resolution', () => {
  it('launches the installed package entry point with Node in the session directory', () => {
    const resolveModule = jest.fn(() => '/packages/mcp-rubber-duck/dist/index.js');
    const launch = resolveRubberDuckLaunch('/sessions/RC-1', {
      resolveModule,
      execPath: '/node/bin/node',
      environment: { PATH: '/bin', API_KEY: 'secret', OMIT: undefined },
    });

    expect(resolveModule).toHaveBeenCalledWith('mcp-rubber-duck');
    expect(launch).toEqual({
      command: '/node/bin/node',
      args: ['/packages/mcp-rubber-duck/dist/index.js'],
      cwd: '/sessions/RC-1',
      env: { PATH: '/bin', API_KEY: 'secret' },
      stderr: 'inherit',
    });
  });

  it('removes undefined values while preserving provider credentials', () => {
    expect(definedEnvironment({ OPENAI_API_KEY: 'key', MISSING: undefined })).toEqual({
      OPENAI_API_KEY: 'key',
    });
  });

  it('moves default Codex and Claude presets to bounded read-only stdin invocations', () => {
    const environment = rubberDuckEnvironment(
      {
        CLI_CODEX_ENABLED: 'true',
        CLI_CLAUDE_ENABLED: 'true',
        CLI_CLAUDE_NICKNAME: 'Reviewer',
        CLI_CLAUDE_DEFAULT_MODEL: 'claude-fable-5[1m]',
        HYPOTHESIS_COUNCIL_CODEX_REASONING_EFFORT: 'xhigh',
      },
      'gpt-5.6-sol'
    );

    expect(environment.CLI_CODEX_ENABLED).toBeUndefined();
    expect(environment.CLI_CLAUDE_ENABLED).toBeUndefined();
    expect(environment).toMatchObject({
      CLI_CUSTOM_CODEX_COMMAND: 'codex',
      CLI_CUSTOM_CODEX_PROMPT_DELIVERY: 'stdin',
      CLI_CUSTOM_CODEX_OUTPUT_FORMAT: 'text',
      CLI_CUSTOM_CODEX_DEFAULT_MODEL: 'gpt-5.6-sol',
      CLI_CUSTOM_CODEX_PROCESS_TIMEOUT: '300000',
      CLI_CUSTOM_CLAUDE_COMMAND: 'claude',
      CLI_CUSTOM_CLAUDE_PROMPT_DELIVERY: 'stdin',
      CLI_CUSTOM_CLAUDE_OUTPUT_FORMAT: 'json',
      CLI_CUSTOM_CLAUDE_NICKNAME: 'Reviewer',
      CLI_CUSTOM_CLAUDE_PROCESS_TIMEOUT: '300000',
    });
    expect(environment.CLI_CUSTOM_CODEX_CLI_ARGS).toContain('--sandbox,read-only');
    expect(environment.CLI_CUSTOM_CODEX_CLI_ARGS).toContain(
      '--model,gpt-5.6-sol,-c,model_reasoning_effort="xhigh"'
    );
    expect(environment.CLI_CUSTOM_CODEX_CLI_ARGS).not.toContain('--full-auto');
    expect(environment.CLI_CUSTOM_CLAUDE_CLI_ARGS).toContain('--permission-mode,dontAsk');
    expect(environment.CLI_CUSTOM_CLAUDE_CLI_ARGS).toContain('--model,claude-fable-5[1m]');
    expect(environment.CLI_CUSTOM_CLAUDE_CLI_ARGS?.split(',').slice(-3)).toEqual([
      '--strict-mcp-config',
      '--tools',
      '',
    ]);
  });

  it('applies global and provider-specific stdin process timeouts', () => {
    const environment = rubberDuckEnvironment({
      CLI_CODEX_ENABLED: 'true',
      CLI_CLAUDE_ENABLED: 'true',
      CLI_CLAUDE_PROCESS_TIMEOUT: '600000',
      HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS: '900000',
    });

    expect(environment.CLI_CUSTOM_CODEX_PROCESS_TIMEOUT).toBe('900000');
    expect(environment.CLI_CUSTOM_CLAUDE_PROCESS_TIMEOUT).toBe('600000');
  });

  it('rejects an unsupported Codex reasoning effort', () => {
    expect(() =>
      rubberDuckEnvironment({
        CLI_CODEX_ENABLED: 'true',
        HYPOTHESIS_COUNCIL_CODEX_REASONING_EFFORT: 'extreme',
      })
    ).toThrow('HYPOTHESIS_COUNCIL_CODEX_REASONING_EFFORT');
  });

  it('preserves explicit Rubber Duck CLI overrides', () => {
    const environment = rubberDuckEnvironment({
      CLI_CODEX_ENABLED: 'true',
      CLI_CODEX_CLI_ARGS: 'exec,--json',
      CLI_CLAUDE_ENABLED: 'true',
      CLI_CLAUDE_SYSTEM_PROMPT: 'Use the configured policy.',
    });

    expect(environment.CLI_CODEX_ENABLED).toBe('true');
    expect(environment.CLI_CODEX_CLI_ARGS).toBe('exec,--json');
    expect(environment.CLI_CUSTOM_CODEX_COMMAND).toBeUndefined();
    expect(environment.CLI_CLAUDE_ENABLED).toBe('true');
    expect(environment.CLI_CUSTOM_CLAUDE_COMMAND).toBeUndefined();
  });
});

describe('Rubber Duck installation helpers', () => {
  it('reads the installed Rubber Duck version from its package manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'hc-rd-version-'));
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'mcp-rubber-duck', version: '9.9.9' })
    );
    writeFileSync(join(root, 'dist', 'index.js'), '');

    expect(installedRubberDuckVersion(() => join(root, 'dist', 'index.js'))).toBe('9.9.9');
    expect(
      installedRubberDuckVersion(() => {
        throw new Error('missing');
      })
    ).toBeUndefined();
    expect(installedRubberDuckVersion()).toBe('1.20.5');
  });

  it('locates the stdin shim beside the launch module', () => {
    expect(resolveStdinShimPath().split('\\').join('/')).toMatch(/\/rubber-duck\/stdin-shim\.js$/);
  });
});
