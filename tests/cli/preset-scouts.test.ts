import {
  applyPreset,
  findPreset,
  presetScoutProviders,
  presetsText,
} from '../../src/cli/presets.js';
import { isScoutProvider } from '../../src/research/sources.js';
import { CODEX_WEB_SEARCH_VARIABLE } from '../../src/rubber-duck/scout-profiles.js';
import { webAccessFromArgs } from '../../src/rubber-duck/vendor-args.js';
import { providerWebAccess } from '../../src/cli/doctor.js';

const launch = { execPath: '/node/bin/node', shimPath: '/hc/dist/rubber-duck/stdin-shim.js' };

describe('preset web scouts', () => {
  it('names the scouts each preset configures', () => {
    expect(presetScoutProviders(findPreset('frontier'))).toEqual([
      'cli-claude_scout',
      'cli-codex_scout',
      'cli-grok_scout',
    ]);
    expect(presetScoutProviders(findPreset('quick'))).toEqual([
      'cli-claude_scout',
      'cli-codex_scout',
    ]);
    expect(presetScoutProviders(findPreset('frontier')).every(isScoutProvider)).toBe(true);
    expect(presetsText()).toContain(
      'web scouts: cli-claude_scout, cli-codex_scout, cli-grok_scout'
    );
    expect(presetsText()).toContain('never on the council');
  });

  it('configures frontier scouts with the web open and the council closed', () => {
    const environment: NodeJS.ProcessEnv = { PATH: '/bin' };
    applyPreset(findPreset('frontier'), environment, launch);

    expect(environment).toMatchObject({
      CLI_CUSTOM_CLAUDE_SCOUT_COMMAND: 'claude',
      CLI_CUSTOM_CLAUDE_SCOUT_PROMPT_DELIVERY: 'stdin',
      CLI_CUSTOM_CLAUDE_SCOUT_DEFAULT_MODEL: 'claude-fable-5-1[1m]',
      CLI_CUSTOM_CLAUDE_SCOUT_PROCESS_TIMEOUT: '900000',
      CLI_CUSTOM_CODEX_SCOUT_COMMAND: 'codex',
      CLI_CUSTOM_CODEX_SCOUT_DEFAULT_MODEL: 'gpt-6.1-sol',
      CLI_CUSTOM_GROK_SCOUT_COMMAND: '/node/bin/node',
      CLI_CUSTOM_GROK_SCOUT_CLI_ARGS:
        '/hc/dist/rubber-duck/stdin-shim.js,prompt-file,--,grok,-m,grok-4.7,--reasoning-effort,high',
    });
    const claudeScout = environment.CLI_CUSTOM_CLAUDE_SCOUT_CLI_ARGS!.split(',');
    expect(claudeScout).toContain('--restricted');
    expect(webAccessFromArgs('claude', claudeScout)).toBe('on');
    expect(
      webAccessFromArgs('codex', environment.CLI_CUSTOM_CODEX_SCOUT_CLI_ARGS!.split(','))
    ).toBe('on');
    expect(environment.CLI_CUSTOM_CODEX_SCOUT_CLI_ARGS).toContain('model_reasoning_effort="high"');

    const descriptor = (name: string) => ({
      name,
      nickname: name,
      model: 'm',
      type: 'cli' as const,
    });
    expect(providerWebAccess(descriptor('cli-claude_scout'), environment)).toBe('on');
    expect(providerWebAccess(descriptor('cli-codex_scout'), environment)).toBe('on');
    expect(providerWebAccess(descriptor('cli-grok_scout'), environment)).toBe('on');
    expect(providerWebAccess(descriptor('cli-claude'), environment)).toBe('off');
    expect(providerWebAccess(descriptor('cli-codex'), environment)).toBe('off');
    expect(providerWebAccess(descriptor('cli-grok'), environment)).toBe('off');
  });

  it('honours the Codex web-search override and leaves the quick preset scouts unpinned', () => {
    const environment: NodeJS.ProcessEnv = { [CODEX_WEB_SEARCH_VARIABLE]: 'web_search=cached' };
    applyPreset(findPreset('quick'), environment, launch);
    expect(environment.CLI_CUSTOM_CODEX_SCOUT_CLI_ARGS!.split(',')).toContain('web_search=cached');
    expect(environment.CLI_CUSTOM_CLAUDE_SCOUT_DEFAULT_MODEL).toBeUndefined();
    expect(environment.CLI_CUSTOM_CODEX_SCOUT_DEFAULT_MODEL).toBeUndefined();
    expect(environment.CLI_CUSTOM_GROK_SCOUT_COMMAND).toBeUndefined();
  });
});
