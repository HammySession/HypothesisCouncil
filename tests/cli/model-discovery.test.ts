import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  discoverModels,
  loadModelCache,
  modelCachePath,
  parseAgyModelsOutput,
  parseClaudeConfig,
  parseCodexCatalog,
  parseGrokCache,
  parseGrokModelsOutput,
  resolveCouncilModels,
  type DiscoveryOptions,
} from '../../src/cli/model-discovery.js';
import { findPreset } from '../../src/cli/presets.js';
import {
  AGY_MODELS_TEXT,
  CLAUDE_JSON,
  CLAUDE_SETTINGS,
  CODEX_CATALOG,
  GROK_CACHE,
  GROK_MODELS_TEXT,
  createFakeRunner,
  writeVendorHome,
  type FakeRunner,
} from './model-fixtures.js';

const NOW = Date.parse('2026-09-04T12:00:00Z');

function makeOptions(
  runner: FakeRunner,
  overrides: Partial<DiscoveryOptions> = {}
): DiscoveryOptions & { sessionHome: string } {
  const home = mkdtempSync(join(tmpdir(), 'hc-vendor-home-'));
  const sessionHome = mkdtempSync(join(tmpdir(), 'hc-session-home-'));
  return {
    environment: {},
    platform: 'linux',
    homeDirectory: home,
    cachePath: modelCachePath(sessionHome),
    run: runner.run,
    locateCommand: (command) => `/bin/${command}`,
    now: () => NOW,
    sessionHome,
    ...overrides,
  };
}

describe('vendor listing parsers', () => {
  it('reads the Codex catalog with visibility, upgrades, priorities, and windows', () => {
    const models = parseCodexCatalog(JSON.stringify(CODEX_CATALOG));
    expect(models.map((model) => model.id)).toEqual(
      CODEX_CATALOG.models.map((model) => model.slug)
    );
    expect(models.find((model) => model.id === 'gpt-reserve')).toMatchObject({ hidden: true });
    expect(models.find((model) => model.id === 'gpt-5.4')).toMatchObject({
      supersededBy: 'gpt-5.6-terra',
    });
    expect(models.find((model) => model.id === 'gpt-5.6-sol')).toMatchObject({
      priority: 6,
      contextWindowTokens: 272_000,
      reasoningLevels: ['low', 'medium', 'high', 'xhigh'],
    });
    expect(models.find((model) => model.id === 'gpt-5.6-sol')?.hidden).toBeUndefined();
  });

  it('reads the Grok cache field by field and never carries credentials', () => {
    const models = parseGrokCache(JSON.stringify(GROK_CACHE));
    expect(models).toEqual([
      {
        id: 'grok-4.6',
        displayName: 'Grok 4.6',
        contextWindowTokens: 500_000,
        reasoningLevels: ['xhigh', 'high', 'medium', 'low'],
      },
      {
        id: 'grok-4.5',
        displayName: 'Grok 4.5',
        contextWindowTokens: 256_000,
        reasoningLevels: ['high'],
      },
      {
        id: 'grok-code-fast-1',
        displayName: 'Grok Code Fast',
        contextWindowTokens: 256_000,
        hidden: true,
        reasoningLevels: [],
      },
    ]);
    expect(JSON.stringify(models)).not.toMatch(/FAKE|api_key|env_key|auth_method/);
  });

  it('parses the grok and agy listing commands', () => {
    expect(parseGrokModelsOutput(GROK_MODELS_TEXT).map((model) => model.id)).toEqual([
      'grok-4.6',
      'grok-4.5',
    ]);
    const agy = parseAgyModelsOutput(AGY_MODELS_TEXT);
    expect(agy.map((model) => model.id)).toEqual([
      'gemini-3.8-flash-high',
      'gemini-3.8-flash-medium',
      'gemini-3.8-flash-low',
      'gemini-3.7-flash-high',
      'gemini-3.6-flash-high',
      'gemini-3.1-pro-high',
      'gemini-3.1-pro-low',
    ]);
    expect(agy[0].displayName).toBe('Gemini 3.8 Flash (High)');
    expect(() => parseGrokModelsOutput('You are logged in\n')).toThrow('listed no models');
    expect(() => parseAgyModelsOutput('Fetching...\nclaude-sonnet-4-6\tClaude\n')).toThrow(
      'no Gemini models'
    );
  });

  it('reads Claude Code ids from the configuration files without the account block', () => {
    const models = parseClaudeConfig(JSON.stringify(CLAUDE_JSON), JSON.stringify(CLAUDE_SETTINGS));
    expect(models).toEqual([
      { id: 'claude-fable-5-1[1m]', displayName: 'Fable' },
      { id: 'fable[1m]', displayName: 'settings.json model' },
    ]);
    expect(JSON.stringify(models)).not.toMatch(/oauth|FAKE|example\.invalid/);
    expect(() => parseClaudeConfig(undefined, undefined)).toThrow('no model ids');
  });
});

describe('discoverModels', () => {
  it('serves fresh vendor caches and configuration without spawning anything', async () => {
    const runner = createFakeRunner();
    const options = makeOptions(runner);
    writeVendorHome(options.homeDirectory);
    const result = await discoverModels(['codex', 'grok', 'claude'], options);

    expect(runner.calls).toEqual([]);
    expect(result.codex).toMatchObject({ source: 'vendor-cache', fresh: true });
    expect(result.codex?.models.map((model) => model.id)).toContain('gpt-5.6-sol');
    expect(result.grok).toMatchObject({ source: 'vendor-cache', fresh: true });
    expect(result.claude).toMatchObject({ source: 'vendor-config', fresh: true });
    expect(result.claude?.models[0].id).toBe('claude-fable-5-1[1m]');
  });

  it('runs the read-only listing commands when caches are missing and records them in the HC cache', async () => {
    const runner = createFakeRunner();
    const options = makeOptions(runner);
    const result = await discoverModels(['codex', 'grok', 'gemini'], options);

    expect(
      runner.calls
        .map((call) => `${call.command.replace(/^\/bin\//, '')} ${call.args.join(' ')}`)
        .sort()
    ).toEqual(['agy models', 'codex debug models', 'grok models']);
    expect(result.gemini).toMatchObject({
      source: 'vendor-command',
      detail: 'agy models',
      fresh: true,
    });
    expect(result.codex?.source).toBe('vendor-command');
    expect(result.grok?.models.map((model) => model.id)).toEqual(['grok-4.6', 'grok-4.5']);

    const cache = loadModelCache(options.cachePath);
    expect(Object.keys(cache.vendors).sort()).toEqual(['codex', 'gemini', 'grok']);
    expect(cache.vendors.gemini?.fetchedAt).toBe(new Date(NOW).toISOString());
    const raw = readFileSync(options.cachePath, 'utf8');
    expect(raw).not.toMatch(/FAKE|api_key|instructions/);
    if (process.platform !== 'win32') {
      expect(statSync(options.cachePath).mode & 0o777).toBe(0o600);
    }
  });

  it('answers from the HC cache inside the TTL and re-runs after it or on refresh', async () => {
    const runner = createFakeRunner();
    const options = makeOptions(runner);
    await discoverModels(['gemini'], options);
    expect(runner.calls).toHaveLength(1);

    const cached = await discoverModels(['gemini'], { ...options, now: () => NOW + 60_000 });
    expect(runner.calls).toHaveLength(1);
    expect(cached.gemini).toMatchObject({ source: 'hc-cache', detail: 'agy models', fresh: true });

    await discoverModels(['gemini'], { ...options, now: () => NOW + 25 * 60 * 60 * 1000 });
    expect(runner.calls).toHaveLength(2);

    await discoverModels(['gemini'], { ...options, refresh: true });
    expect(runner.calls).toHaveLength(3);

    await discoverModels(['gemini'], {
      ...options,
      environment: { HYPOTHESIS_COUNCIL_MODEL_CACHE_TTL_MS: '1000' },
      now: () => NOW + 5_000,
    });
    expect(runner.calls).toHaveLength(4);
  });

  it('falls back to the stale HC cache, then the curated table, and reports the error', async () => {
    const healthy = createFakeRunner();
    const options = makeOptions(healthy);
    await discoverModels(['gemini'], options);

    const broken = createFakeRunner({ agy: new Error('agy exploded'), grok: new Error('no grok') });
    const stale = await discoverModels(['gemini', 'grok'], {
      ...options,
      run: broken.run,
      refresh: true,
    });
    expect(stale.gemini).toMatchObject({
      source: 'hc-cache',
      fresh: false,
      error: 'agy exploded',
    });
    expect(stale.gemini?.models.map((model) => model.id)).toContain('gemini-3.8-flash-high');
    expect(stale.grok).toMatchObject({ source: 'curated', fresh: false, error: 'no grok' });
    expect(stale.grok?.models.map((model) => model.id)).toEqual(['grok-4.7', 'grok-4.6']);
  });

  it('reports a missing command and a timeout without rejecting', async () => {
    const slow = createFakeRunner();
    const options = makeOptions(slow, {
      locateCommand: (command) => (command === 'agy' ? undefined : `/bin/${command}`),
      run: (command, args, runOptions) =>
        command.endsWith('grok')
          ? new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error(`${command} timed out after ${runOptions.timeoutMs} ms`)),
                5
              )
            )
          : slow.run(command, args, runOptions),
      timeoutMs: 50,
    });
    const result = await discoverModels(['gemini', 'grok'], options);
    expect(result.gemini?.error).toBe('agy is not on PATH');
    expect(result.grok?.error).toMatch(/timed out after 50 ms/);
  });

  it('prefers a stale vendor cache over a failing command and honours CODEX_HOME', async () => {
    const runner = createFakeRunner({ codex: new Error('codex crashed') });
    const options = makeOptions(runner);
    const codexHome = mkdtempSync(join(tmpdir(), 'hc-codex-home-'));
    writeFileSync(
      join(codexHome, 'models_cache.json'),
      JSON.stringify({ ...CODEX_CATALOG, fetched_at: '2026-01-01T00:00:00Z' })
    );
    const result = await discoverModels(['codex'], {
      ...options,
      environment: { CODEX_HOME: codexHome },
    });
    expect(runner.calls).toHaveLength(1);
    expect(result.codex).toMatchObject({ source: 'vendor-cache', fresh: true });
    expect(result.codex?.detail).toBe(join(codexHome, 'models_cache.json'));
  });

  it('ignores an unreadable HC cache', () => {
    const sessionHome = mkdtempSync(join(tmpdir(), 'hc-session-home-'));
    const path = modelCachePath(sessionHome);
    writeFileSync(path, '{not json');
    expect(loadModelCache(path)).toEqual({ version: 1, vendors: {} });
    expect(loadModelCache(join(sessionHome, 'missing.json'))).toEqual({ version: 1, vendors: {} });
    expect(existsSync(path)).toBe(true);
  });
});

describe('resolveCouncilModels', () => {
  const frontier = findPreset('frontier');

  it('resolves every frontier slot from discovery and trusts discovered windows', async () => {
    const runner = createFakeRunner();
    const options = makeOptions(runner);
    writeVendorHome(options.homeDirectory);
    const { models, discoveries } = await resolveCouncilModels(frontier, {
      policy: 'latest',
      discovery: options,
    });
    expect(models.grok).toMatchObject({
      id: 'grok-4.6',
      origin: 'latest',
      contextWindowTokens: 500_000,
    });
    expect(models.agy).toMatchObject({ id: 'gemini-3.8-flash-high', origin: 'latest' });
    expect(models.agy.contextWindowTokens).toBe(1_000_000); // the pin's window applies to the same id
    expect(models.claude).toMatchObject({ id: 'claude-fable-5-1[1m]', origin: 'latest' });
    expect(models.codex).toMatchObject({
      id: 'gpt-5.6-sol',
      origin: 'latest',
      contextWindowTokens: 272_000,
    });
    expect(Object.keys(discoveries).sort()).toEqual(['claude', 'codex', 'gemini', 'grok']);
    expect(runner.calls.map((call) => call.args.join(' '))).toEqual(['models']);
  });

  it('skips discovery for explicit ids and under the pinned policy', async () => {
    const runner = createFakeRunner();
    const options = makeOptions(runner);
    const pinned = await resolveCouncilModels(frontier, { policy: 'pinned', discovery: options });
    expect(runner.calls).toEqual([]);
    expect(pinned.models.agy).toMatchObject({ id: 'gemini-3.8-flash-high', origin: 'pinned' });
    expect(pinned.models.codex).toMatchObject({
      id: 'gpt-6.1-sol',
      origin: 'pinned',
      contextWindowTokens: 272_000,
    });

    const explicit = await resolveCouncilModels(frontier, {
      policy: 'latest',
      explicit: { codex: 'gpt-5.5' },
      snapshot: { CLI_CLAUDE_DEFAULT_MODEL: 'claude-opus-4-6', CLI_GROK_DEFAULT_MODEL: 'grok-4.5' },
      discovery: options,
    });
    expect(explicit.models.codex).toMatchObject({ id: 'gpt-5.5', origin: 'explicit' });
    expect(explicit.models.claude).toMatchObject({ id: 'claude-opus-4-6', origin: 'explicit' });
    expect(explicit.models.grok).toMatchObject({ id: 'grok-4.5', origin: 'explicit' });
    expect(explicit.models.agy).toMatchObject({ id: 'gemini-3.8-flash-high', origin: 'latest' });
    expect(runner.calls.map((call) => call.command)).toEqual(['/bin/agy']);
  });

  it('falls back to the pins when every vendor fails and honours the Gemini family knob', async () => {
    const broken = createFakeRunner({
      agy: new Error('agy down'),
      codex: new Error('codex down'),
      grok: new Error('grok down'),
    });
    const options = makeOptions(broken);
    const { models } = await resolveCouncilModels(frontier, {
      policy: 'latest',
      discovery: options,
    });
    expect(models.grok).toMatchObject({ id: 'grok-4.7', origin: 'fallback', note: 'grok down' });
    expect(models.agy).toMatchObject({ id: 'gemini-3.8-flash-high', origin: 'fallback' });
    expect(models.claude).toMatchObject({ id: 'claude-fable-5-1[1m]', origin: 'fallback' });
    expect(models.codex).toMatchObject({
      id: 'gpt-6.1-sol',
      origin: 'fallback',
      contextWindowTokens: 272_000,
    });

    const healthy = createFakeRunner();
    const pro = await resolveCouncilModels(frontier, {
      policy: 'latest',
      discovery: makeOptions(healthy, {
        environment: { HYPOTHESIS_COUNCIL_MODEL_FAMILY_GEMINI: 'pro' },
      }),
    });
    expect(pro.models.agy.id).toBe('gemini-3.1-pro-high');
  });

  it('has nothing to resolve for a preset without model slots', async () => {
    const runner = createFakeRunner();
    const result = await resolveCouncilModels(findPreset('quick'), {
      policy: 'latest',
      discovery: makeOptions(runner),
    });
    expect(result).toEqual({ models: {}, discoveries: {} });
    expect(runner.calls).toEqual([]);
  });
});
