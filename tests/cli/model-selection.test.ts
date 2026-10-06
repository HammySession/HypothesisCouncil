import {
  CURATED_LATEST,
  MODEL_VENDORS,
  describeModelOrigin,
  parseModelId,
  pickLatestModel,
  resolveModelChoice,
  type DiscoveredModel,
} from '../../src/cli/model-selection.js';
import { parseAgyModelsOutput, parseCodexCatalog } from '../../src/cli/model-discovery.js';
import { AGY_MODELS_TEXT, CODEX_CATALOG } from './model-fixtures.js';

const ids = (list: string[]): DiscoveredModel[] => list.map((id) => ({ id }));

function shuffled<T>(items: T[], seed: number): T[] {
  const copy = [...items];
  let state = seed;
  for (let index = copy.length - 1; index > 0; index--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const swap = state % (index + 1);
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

describe('parseModelId', () => {
  it('splits vendor, family, version, tier, effort, and context suffix', () => {
    expect(parseModelId('claude-fable-5-1[1m]')).toMatchObject({
      vendor: 'claude',
      family: 'fable',
      version: [5, 1],
      contextSuffix: '1m',
    });
    expect(parseModelId('gpt-5.6-sol')).toMatchObject({
      vendor: 'codex',
      family: 'gpt',
      version: [5, 6],
      tier: 'sol',
    });
    expect(parseModelId('gemini-3.8-flash-high')).toMatchObject({
      vendor: 'gemini',
      version: [3, 8],
      tier: 'flash',
      effort: 'high',
    });
    expect(parseModelId('grok-code-fast-1')).toMatchObject({ vendor: 'grok', family: 'grok-code' });
    expect(parseModelId('fable[1m]')).toMatchObject({
      vendor: 'claude',
      family: 'fable',
      version: [],
    });
  });

  it('flags mini, preview, and dated snapshot variants for exclusion', () => {
    expect(parseModelId('gpt-5.4-mini').excludedVariant).toBe('mini');
    expect(parseModelId('gemini-3.5-flash-lite').excludedVariant).toBe('lite');
    expect(parseModelId('gpt-5.3-codex-spark').excludedVariant).toBe('spark');
    expect(parseModelId('gemini-2.5-pro-preview').excludedVariant).toBe('preview');
    expect(parseModelId('claude-opus-4-20250514')).toMatchObject({
      excludedVariant: 'snapshot',
      snapshotDate: '20250514',
      version: [4],
    });
    expect(parseModelId('gemini-3.8-flash-high').excludedVariant).toBeUndefined();
  });
});

describe('pickLatestModel', () => {
  const codexModels = parseCodexCatalog(JSON.stringify(CODEX_CATALOG));
  const agyModels = parseAgyModelsOutput(AGY_MODELS_TEXT);

  it('chooses gpt-5.6-sol from the Codex catalog, skipping hidden and superseded ids', () => {
    expect(pickLatestModel('codex', codexModels)?.id).toBe('gpt-5.6-sol');
  });

  it('ranks gpt-6.1 above the gpt-6 and gpt-5.6 families and drops the retiring gpt-5.5', () => {
    const models: DiscoveredModel[] = [
      { id: 'gpt-5.6-sol', priority: 5 },
      { id: 'gpt-6-sol', priority: 3 },
      { id: 'gpt-6-astra', priority: 2 },
      { id: 'gpt-6.1-sol', priority: 1 },
      { id: 'gpt-reserve', priority: 4, hidden: true },
      { id: 'gpt-5.5', priority: 13, supersededBy: 'gpt-6.1-sol' },
    ];
    expect(pickLatestModel('codex', models)?.id).toBe('gpt-6.1-sol');
    expect(pickLatestModel('codex', models.slice(0, 3))?.id).toBe('gpt-6-astra');
  });

  it('prefers the newest Gemini version over the pro tier by default', () => {
    expect(pickLatestModel('gemini', agyModels)?.id).toBe('gemini-3.8-flash-high');
  });

  it('puts the pro tier first when the family preference says so', () => {
    expect(pickLatestModel('gemini', agyModels, { preferGeminiTier: 'pro' })?.id).toBe(
      'gemini-3.1-pro-high'
    );
  });

  it('ranks Claude families fable > opus > sonnet > haiku and prefers 1M profiles', () => {
    const models = ids([
      'claude-opus-4-6',
      'claude-fable-5-1',
      'claude-fable-5-1[1m]',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'fable[1m]',
    ]);
    expect(pickLatestModel('claude', models)?.id).toBe('claude-fable-5-1[1m]');
  });

  it('ranks grok-4.6 above grok-4.5 and the code family, and drops hidden entries', () => {
    const models: DiscoveredModel[] = [
      { id: 'grok-code-fast-1' },
      { id: 'grok-4.5' },
      { id: 'grok-4.6' },
      { id: 'grok-5', hidden: true },
    ];
    expect(pickLatestModel('grok', models)?.id).toBe('grok-4.6');
  });

  it('ranks grok-4.7 above its build-fast variant in either listing order', () => {
    const models = ids(['grok-4.7-build-fast', 'grok-4.7', 'grok-4.6', 'grok-4.5']);
    expect(pickLatestModel('grok', models)?.id).toBe('grok-4.7');
    expect(pickLatestModel('grok', [...models].reverse())?.id).toBe('grok-4.7');
  });

  it('drops ids from other vendors in a mixed listing', () => {
    const models = ids(['claude-opus-4-6-thinking', 'gpt-oss-120b-medium', 'gemini-3.1-pro-high']);
    expect(pickLatestModel('gemini', models)?.id).toBe('gemini-3.1-pro-high');
    expect(pickLatestModel('codex', ids(['claude-opus-4-6', 'gemini-3.1-pro']))).toBeUndefined();
  });

  it('falls back to excluded variants only when nothing else remains', () => {
    expect(pickLatestModel('codex', ids(['gpt-5.4-mini', 'gpt-5.3-nano']))?.id).toBe(
      'gpt-5.4-mini'
    );
    expect(pickLatestModel('codex', ids(['gpt-5.4-mini', 'gpt-5.2']))?.id).toBe('gpt-5.2');
  });

  it('is stable regardless of listing order', () => {
    for (const seed of [1, 7, 42, 1234]) {
      expect(pickLatestModel('codex', shuffled(codexModels, seed))?.id).toBe('gpt-5.6-sol');
      expect(pickLatestModel('gemini', shuffled(agyModels, seed))?.id).toBe(
        'gemini-3.8-flash-high'
      );
    }
  });

  it('returns undefined for an empty listing', () => {
    for (const vendor of MODEL_VENDORS) expect(pickLatestModel(vendor, [])).toBeUndefined();
  });
});

describe('resolveModelChoice', () => {
  const discovered: DiscoveredModel[] = [
    { id: 'gpt-5.6-sol', contextWindowTokens: 272_000 },
    { id: 'gpt-5.5', contextWindowTokens: 272_000 },
  ];

  it('lets an explicit id win over everything else', () => {
    const model = resolveModelChoice({
      vendor: 'codex',
      policy: 'latest',
      pinned: 'gpt-5.5',
      explicit: 'gpt-5.4',
      discovered,
    });
    expect(model).toMatchObject({
      id: 'gpt-5.4',
      origin: 'explicit',
      latestDiscovered: 'gpt-5.6-sol',
    });
    expect(model.contextWindowTokens).toBeUndefined();
    expect(describeModelOrigin(model)).toBe('explicit');
  });

  it('uses the pin under the pinned policy even when discovery knows better', () => {
    const model = resolveModelChoice({
      vendor: 'codex',
      policy: 'pinned',
      pinned: 'gpt-5.5',
      pinnedContextTokens: 1_050_000,
      discovered,
    });
    expect(model).toMatchObject({ id: 'gpt-5.5', origin: 'pinned', contextWindowTokens: 272_000 });
    expect(describeModelOrigin(model)).toBe('pinned');
  });

  it('takes the discovered latest with its context window under the latest policy', () => {
    const model = resolveModelChoice({
      vendor: 'codex',
      policy: 'latest',
      pinned: 'gpt-5.5',
      discovered,
      source: 'vendor-command',
    });
    expect(model).toMatchObject({
      id: 'gpt-5.6-sol',
      origin: 'latest',
      contextWindowTokens: 272_000,
      discoveredCount: 2,
      source: 'vendor-command',
    });
    expect(describeModelOrigin(model)).toBe('auto: latest of 2');
  });

  it('falls back to the pin, then the curated table, when discovery fails', () => {
    const pinned = resolveModelChoice({
      vendor: 'codex',
      policy: 'latest',
      pinned: 'gpt-5.5',
      pinnedContextTokens: 1_050_000,
      discoveryError: 'codex is not on PATH',
    });
    expect(pinned).toMatchObject({
      id: 'gpt-5.5',
      origin: 'fallback',
      contextWindowTokens: 1_050_000,
      note: 'codex is not on PATH',
    });
    expect(describeModelOrigin(pinned)).toBe('fallback: codex is not on PATH');

    const curated = resolveModelChoice({ vendor: 'gemini', policy: 'latest' });
    expect(curated).toMatchObject({ id: CURATED_LATEST.gemini[0], origin: 'fallback' });
  });
});
