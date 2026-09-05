import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  PRESETS,
  applyPreset,
  describeModels,
  explicitModelsFromEnvironment,
  findPreset,
  missingPresetCommands,
  modelsByProvider,
  pinnedModels,
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
        '/hc/dist/rubber-duck/stdin-shim.js,prompt-file,--,grok,-m,grok-4.6,--reasoning-effort,xhigh,--disable-web-search',
      CLI_CUSTOM_GROK_PROCESS_TIMEOUT: '900000',
      CLI_CUSTOM_AGY_COMMAND: '/node/bin/node',
      CLI_CUSTOM_AGY_PROMPT_DELIVERY: 'stdin',
      CLI_CUSTOM_AGY_OUTPUT_FORMAT: 'text',
      CLI_CUSTOM_AGY_CLI_ARGS:
        '/hc/dist/rubber-duck/stdin-shim.js,agy-stream-json,--,agy,--model,gemini-3.8-flash-high,--effort,high,--sandbox',
      CLI_CUSTOM_AGY_DEFAULT_MODEL: 'gemini-3.8-flash-high',
      HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_AGY: '1000000',
      CLI_CLAUDE_ENABLED: 'true',
      CLI_CLAUDE_DEFAULT_MODEL: 'claude-fable-5[1m]',
      HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_CLAUDE: '1000000',
      CLI_CODEX_ENABLED: 'true',
      CLI_CODEX_DEFAULT_MODEL: 'gpt-5.6-sol',
      HYPOTHESIS_COUNCIL_CODEX_REASONING_EFFORT: 'xhigh',
      HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_CODEX: '1050000',
      HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS: '900000',
    });
    expect(environment.HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_GROK).toBeUndefined();

    // The wrapper still adapts Claude and Codex to stdin on top of the preset.
    const launched = rubberDuckEnvironment(environment);
    expect(launched.CLI_CUSTOM_CLAUDE_PROMPT_DELIVERY).toBe('stdin');
    expect(launched.CLI_CUSTOM_CODEX_PROMPT_DELIVERY).toBe('stdin');

    // Nothing in the frontier council is capped by argument transport, even on Windows.
    const plan = calculateContextBudget(
      [
        { name: 'cli-grok', nickname: 'Grok Expert', model: 'grok-4.6', type: 'cli' },
        {
          name: 'cli-agy',
          nickname: 'Gemini Thinking',
          model: 'gemini-3.8-flash-high',
          type: 'cli',
        },
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

  it('writes resolved models and their discovered windows into the environment', () => {
    const environment: NodeJS.ProcessEnv = {};
    const preset = findPreset('frontier');
    const pins = pinnedModels(preset);
    applyPreset(preset, environment, {
      execPath: 'node',
      shimPath: 'shim.js',
      models: {
        ...pins,
        grok: {
          vendor: 'grok',
          id: 'grok-5',
          origin: 'latest',
          contextWindowTokens: 500_000,
          discoveredCount: 2,
        },
        codex: {
          vendor: 'codex',
          id: 'gpt-5.7',
          origin: 'latest',
          contextWindowTokens: 300_000,
          discoveredCount: 5,
        },
        claude: {
          vendor: 'claude',
          id: 'claude-fable-5-1[1m]',
          origin: 'latest',
          discoveredCount: 2,
        },
      },
    });

    expect(environment).toMatchObject({
      CLI_CUSTOM_GROK_DEFAULT_MODEL: 'grok-5',
      CLI_CUSTOM_GROK_CLI_ARGS:
        'shim.js,prompt-file,--,grok,-m,grok-5,--reasoning-effort,xhigh,--disable-web-search',
      HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_GROK: '500000',
      CLI_CODEX_DEFAULT_MODEL: 'gpt-5.7',
      HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_CODEX: '300000',
      CLI_CLAUDE_DEFAULT_MODEL: 'claude-fable-5-1[1m]',
      CLI_CUSTOM_AGY_DEFAULT_MODEL: 'gemini-3.8-flash-high',
      HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_AGY: '1000000',
    });
    // No discovered window for Claude: the context budget derives it from the id instead.
    expect(environment.HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_CLAUDE).toBeUndefined();

    expect(describeModels(preset, pins)).toBe(
      'grok=grok-4.6 (pinned) · agy=gemini-3.8-flash-high (pinned) · claude=claude-fable-5[1m] (pinned) · codex=gpt-5.6-sol (pinned)'
    );
    expect(Object.keys(modelsByProvider(preset, pins))).toEqual([
      'cli-grok',
      'cli-agy',
      'cli-claude',
      'cli-codex',
    ]);
    expect(describeModels(findPreset('quick'), {})).toBe('');
  });

  it('keeps default models and context windows a person set before the preset ran', () => {
    const snapshot: NodeJS.ProcessEnv = {
      CLI_CODEX_DEFAULT_MODEL: 'gpt-5.5',
      CLI_GROK_DEFAULT_MODEL: 'grok-4.5',
      HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_CLAUDE: '150000',
    };
    const environment: NodeJS.ProcessEnv = { ...snapshot };
    const preset = findPreset('frontier');
    expect(explicitModelsFromEnvironment(snapshot, preset)).toEqual({
      codex: 'gpt-5.5',
      grok: 'grok-4.5',
    });

    applyPreset(preset, environment, { execPath: 'node', shimPath: 'shim.js', snapshot });
    expect(environment.CLI_CODEX_DEFAULT_MODEL).toBe('gpt-5.5');
    expect(environment.CLI_GROK_DEFAULT_MODEL).toBe('grok-4.5');
    expect(environment.HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_CLAUDE).toBe('150000');
    expect(environment.CLI_CLAUDE_DEFAULT_MODEL).toBe('claude-fable-5[1m]');
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
    expect(text).toContain('pinned models: grok=grok-4.6, agy=gemini-3.8-flash-high');
  });
});
