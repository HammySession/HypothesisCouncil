import { isScoutProvider } from '../../src/research/sources.js';
import {
  CODEX_WEB_SEARCH_VARIABLE,
  SCOUT_VENDORS,
  scoutEnvironmentKey,
  scoutEnvironmentVariables,
  scoutProfileEnvironment,
  scoutProviderName,
} from '../../src/rubber-duck/scout-profiles.js';
import { webAccessFromArgs } from '../../src/rubber-duck/vendor-args.js';

const base = { execPath: '/usr/bin/node', shimPath: '/opt/hc/stdin-shim.js', timeoutMs: '600000' };

describe('scout profiles', () => {
  it('names scouts so the research layer recognizes them and Rubber Duck lowercases them', () => {
    expect(scoutEnvironmentKey('claude')).toBe('CLAUDE_SCOUT');
    expect(scoutEnvironmentKey('gemini')).toBe('AGY_SCOUT');
    for (const vendor of SCOUT_VENDORS) {
      const name = scoutProviderName(vendor);
      expect(name).toBe(`cli-${scoutEnvironmentKey(vendor).toLowerCase()}`);
      expect(isScoutProvider(name)).toBe(true);
    }
    expect(scoutProviderName('grok')).toBe('cli-grok_scout');
  });

  it('opens exactly the web tools for Claude and keeps it restricted', () => {
    const env = scoutProfileEnvironment('claude', { ...base, model: 'claude-x', maxTurns: 8 });
    expect(env).toMatchObject({
      CLI_CUSTOM_CLAUDE_SCOUT_COMMAND: 'claude',
      CLI_CUSTOM_CLAUDE_SCOUT_PROMPT_DELIVERY: 'stdin',
      CLI_CUSTOM_CLAUDE_SCOUT_OUTPUT_FORMAT: 'json',
      CLI_CUSTOM_CLAUDE_SCOUT_NICKNAME: 'Claude Scout',
      CLI_CUSTOM_CLAUDE_SCOUT_DEFAULT_MODEL: 'claude-x',
      CLI_CUSTOM_CLAUDE_SCOUT_PROCESS_TIMEOUT: '600000',
    });
    const args = env.CLI_CUSTOM_CLAUDE_SCOUT_CLI_ARGS.split(',');
    expect(args).toContain('--restricted');
    expect(args.slice(args.indexOf('--tools'))).toEqual([
      '--tools',
      'WebSearch',
      'WebFetch',
      '--allowedTools',
      'WebSearch',
      'WebFetch',
    ]);
    expect(args.slice(args.indexOf('--max-turns'), args.indexOf('--max-turns') + 2)).toEqual([
      '--max-turns',
      '8',
    ]);
    expect(webAccessFromArgs('claude', args)).toBe('on');
    expect(Object.keys(env).every((key) => key.startsWith('CLI_CUSTOM_CLAUDE_SCOUT_'))).toBe(true);
  });

  it('turns on Codex live web search and honours the override variable', () => {
    const env = scoutProfileEnvironment('codex', {
      ...base,
      model: 'gpt-x',
      reasoningEffort: 'high',
    });
    const args = env.CLI_CUSTOM_CODEX_SCOUT_CLI_ARGS.split(',');
    expect(env.CLI_CUSTOM_CODEX_SCOUT_COMMAND).toBe('codex');
    expect(args).toEqual(
      expect.arrayContaining([
        '--sandbox',
        'read-only',
        '-c',
        'model_reasoning_effort="high"',
        'web_search="live"',
      ])
    );
    expect(webAccessFromArgs('codex', args)).toBe('on');

    const custom = scoutProfileEnvironment('codex', {
      ...base,
      environment: { [CODEX_WEB_SEARCH_VARIABLE]: 'web_search=cached' },
    });
    expect(custom.CLI_CUSTOM_CODEX_SCOUT_CLI_ARGS.split(',')).toContain('web_search=cached');
    expect(() =>
      scoutProfileEnvironment('codex', {
        ...base,
        environment: { [CODEX_WEB_SEARCH_VARIABLE]: 'web_search="live",other=1' },
      })
    ).toThrow('must not contain commas');
  });

  it('runs Grok and Gemini scouts through the stdin shim with web search left on', () => {
    const grok = scoutProfileEnvironment('grok', {
      ...base,
      model: 'grok-4',
      reasoningEffort: 'high',
    });
    expect(grok.CLI_CUSTOM_GROK_SCOUT_COMMAND).toBe('/usr/bin/node');
    expect(grok.CLI_CUSTOM_GROK_SCOUT_CLI_ARGS).toBe(
      '/opt/hc/stdin-shim.js,prompt-file,--,grok,-m,grok-4,--reasoning-effort,high'
    );
    expect(grok.CLI_CUSTOM_GROK_SCOUT_CLI_ARGS).not.toContain('--disable-web-search');

    const gemini = scoutProfileEnvironment('gemini', { ...base, model: 'gemini-x' });
    expect(gemini.CLI_CUSTOM_AGY_SCOUT_COMMAND).toBe('/usr/bin/node');
    expect(gemini.CLI_CUSTOM_AGY_SCOUT_CLI_ARGS).toBe(
      '/opt/hc/stdin-shim.js,agy-stream-json,--,agy,--model,gemini-x,--sandbox'
    );
    expect(gemini.CLI_CUSTOM_AGY_SCOUT_NICKNAME).toBe('Gemini Scout');
  });

  it('lists every variable a scout profile can set', () => {
    expect(scoutEnvironmentVariables('claude')).toEqual([
      'CLI_CUSTOM_CLAUDE_SCOUT_COMMAND',
      'CLI_CUSTOM_CLAUDE_SCOUT_PROMPT_DELIVERY',
      'CLI_CUSTOM_CLAUDE_SCOUT_OUTPUT_FORMAT',
      'CLI_CUSTOM_CLAUDE_SCOUT_NICKNAME',
      'CLI_CUSTOM_CLAUDE_SCOUT_DEFAULT_MODEL',
      'CLI_CUSTOM_CLAUDE_SCOUT_CLI_ARGS',
      'CLI_CUSTOM_CLAUDE_SCOUT_PROCESS_TIMEOUT',
    ]);
    for (const vendor of SCOUT_VENDORS) {
      const env = scoutProfileEnvironment(vendor, { ...base, model: 'm' });
      const allowed = new Set(scoutEnvironmentVariables(vendor));
      expect(Object.keys(env).every((key) => allowed.has(key))).toBe(true);
    }
  });
});
