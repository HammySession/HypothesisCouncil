import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  PRESETS,
  applyPreset,
  findPreset,
  missingPresetCommands,
  presetsText,
} from '../../src/cli/presets.js';
import { calculateContextBudget } from '../../src/research/context-budget.js';
import { rubberDuckEnvironment } from '../../src/rubber-duck/launch.js';

describe('council presets', () => {
  it('routes Grok and AGY through the stdin shim and keeps Claude and Codex on stdin presets', () => {
    const environment: NodeJS.ProcessEnv = { CLI_GROK_ENABLED: 'true', PATH: '/bin' };

    applyPreset(findPreset('frontier'), environment, {
      execPath: '/node/bin/node',
      shimPath: '/hc/dist/rubber-duck/stdin-shim.js',
    });

    expect(environment.CLI_GROK_ENABLED).toBeUndefined();
    expect(environment).toMatchObject({
      CLI_CUSTOM_GROK_COMMAND: '/node/bin/node',
      CLI_CUSTOM_GROK_PROMPT_DELIVERY: 'stdin',
      CLI_CUSTOM_GROK_CLI_ARGS:
        '/hc/dist/rubber-duck/stdin-shim.js,prompt-file,--,grok,-m,grok-4.6,--reasoning-effort,xhigh',
      CLI_CUSTOM_GROK_PROCESS_TIMEOUT: '900000',
      CLI_CUSTOM_AGY_COMMAND: '/node/bin/node',
      CLI_CUSTOM_AGY_PROMPT_DELIVERY: 'stdin',
      CLI_CUSTOM_AGY_OUTPUT_FORMAT: 'text',
      CLI_CUSTOM_AGY_CLI_ARGS:
        '/hc/dist/rubber-duck/stdin-shim.js,agy-stream-json,--,agy,--model,gemini-3.1-pro-high,--effort,high,--sandbox',
      CLI_CLAUDE_ENABLED: 'true',
      CLI_CLAUDE_DEFAULT_MODEL: 'claude-fable-5[1m]',
      CLI_CODEX_ENABLED: 'true',
      CLI_CODEX_DEFAULT_MODEL: 'gpt-5.6-sol',
      HYPOTHESIS_COUNCIL_CODEX_REASONING_EFFORT: 'xhigh',
      HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS: '900000',
    });

    // The wrapper still adapts Claude and Codex to stdin on top of the preset.
    const launched = rubberDuckEnvironment(environment);
    expect(launched.CLI_CUSTOM_CLAUDE_PROMPT_DELIVERY).toBe('stdin');
    expect(launched.CLI_CUSTOM_CODEX_PROMPT_DELIVERY).toBe('stdin');

    // Nothing in the frontier council is capped by argument transport, even on Windows.
    const plan = calculateContextBudget(
      [
        { name: 'cli-grok', nickname: 'Grok Expert', model: 'grok-4.6', type: 'cli' },
        { name: 'cli-agy', nickname: 'Gemini Thinking', model: 'gemini-3.1-pro-high', type: 'cli' },
      ],
      ['cli-grok', 'cli-agy'],
      undefined,
      environment,
      'win32'
    );
    expect(plan.providerLimits.every((limit) => !limit.transportLimited)).toBe(true);
    expect(plan.maxBytes).toBeGreaterThan(96 * 1024);
  });

  it('keeps an explicit provider timeout from the environment', () => {
    const environment: NodeJS.ProcessEnv = { HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS: '1200000' };
    applyPreset(findPreset('frontier'), environment, { execPath: 'node', shimPath: 'shim.js' });
    expect(environment.CLI_CUSTOM_GROK_PROCESS_TIMEOUT).toBe('1200000');
    expect(environment.HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS).toBe('1200000');
  });

  it('rejects unknown presets with the available names', () => {
    expect(() => findPreset('nope')).toThrow('Available presets: frontier, quick');
  });

  it('reports which required vendor CLIs are missing from PATH', () => {
    const bin = mkdtempSync(join(tmpdir(), 'hc-preset-bin-'));
    writeFileSync(join(bin, 'claude'), '');
    writeFileSync(join(bin, 'codex'), '');
    const environment = { PATH: bin };

    expect(missingPresetCommands(findPreset('quick'), environment, 'linux')).toEqual([]);
    expect(missingPresetCommands(findPreset('frontier'), environment, 'linux')).toEqual([
      'agy',
      'grok',
    ]);
  });

  it('describes every preset for hc presets', () => {
    const text = presetsText();
    for (const preset of PRESETS) {
      expect(text).toContain(preset.name);
      expect(text).toContain(`providers: ${preset.providers.join(', ')}`);
    }
  });
});
