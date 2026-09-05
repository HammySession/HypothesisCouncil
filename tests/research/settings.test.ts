import {
  DEFAULT_DIALS,
  describeDials,
  dialConfigFrom,
  dialsFromSettings,
  normalizeSettingKey,
  parseDial,
  parseSettingValue,
  resolveSettings,
} from '../../src/research/settings.js';

describe('dial parsing', () => {
  it('accepts integers and named levels', () => {
    expect(parseDial(0)).toBe(0);
    expect(parseDial('10')).toBe(10);
    expect(parseDial(' High ')).toBe(8);
    expect(parseDial('low')).toBe(2);
    expect(parseDial('medium')).toBe(5);
  });

  it('rejects fractions, out-of-range values, and empty strings', () => {
    expect(() => parseDial(2.5, 'novelty')).toThrow('novelty must be an integer from 0 to 10');
    expect(() => parseDial(11)).toThrow('or one of low, medium, high (got 11)');
    expect(() => parseDial('')).toThrow('(got "")');
    expect(() => parseDial('extreme')).toThrow('(got "extreme")');
    expect(() => parseDial(undefined)).toThrow('dial must be an integer');
  });

  it('describes dials with their labels', () => {
    expect(describeDials({ novelty: 8, skepticism: 2 })).toBe(
      'novelty 8/10 (high) · skepticism 2/10 (low)'
    );
    expect(describeDials(DEFAULT_DIALS)).toBe('novelty 5/10 (medium) · skepticism 5/10 (medium)');
  });

  it('turns run inputs into dial configs with origins', () => {
    expect(dialConfigFrom(undefined)).toEqual({
      novelty: 5,
      skepticism: 5,
      origins: { novelty: 'default', skepticism: 'default' },
    });
    expect(dialConfigFrom({ novelty: 9 })).toEqual({
      novelty: 9,
      skepticism: 5,
      origins: { novelty: 'flag', skepticism: 'default' },
    });
    expect(dialConfigFrom({ skepticism: 1, origins: { skepticism: 'file' } })).toEqual({
      novelty: 5,
      skepticism: 1,
      origins: { novelty: 'default', skepticism: 'file' },
    });
    expect(() => dialConfigFrom({ novelty: 12 })).toThrow('novelty must be');
  });
});

describe('setting keys and values', () => {
  it('normalizes key spellings', () => {
    expect(normalizeSettingKey('default-preset')).toBe('defaultPreset');
    expect(normalizeSettingKey('SOURCES.WEB')).toBe('sources.web');
    expect(normalizeSettingKey('markdown_only')).toBe('markdownOnly');
    expect(() => normalizeSettingKey('nope')).toThrow(
      'Unknown setting: nope. Known settings: novelty'
    );
  });

  it('parses each value with its own rule', () => {
    expect(parseSettingValue('novelty', 'high')).toBe(8);
    expect(parseSettingValue('defaultContext', 'src, docs/**/*.md')).toEqual([
      'src',
      'docs/**/*.md',
    ]);
    expect(parseSettingValue('defaultContext', ['a', 'b'])).toEqual(['a', 'b']);
    expect(parseSettingValue('markdownOnly', 'yes')).toBe(true);
    expect(parseSettingValue('markdownOnly', false)).toBe(false);
    expect(parseSettingValue('modelPolicy', 'Pinned')).toBe('pinned');
    expect(parseSettingValue('sources.web', 'off')).toBe('off');
    expect(() => parseSettingValue('sources.web', 'sometimes')).toThrow(
      'sources.web must be one of auto, on, off'
    );
    expect(() => parseSettingValue('defaultPreset', '')).toThrow(
      'defaultPreset must be a non-empty string'
    );
    expect(() => parseSettingValue('defaultContext', [1])).toThrow(
      'defaultContext must be a comma-separated list'
    );
    expect(() => parseSettingValue('markdownOnly', 'maybe')).toThrow(
      'markdownOnly must be true or false'
    );
  });
});

describe('resolveSettings', () => {
  it('applies defaults when nothing is configured', () => {
    const resolved = resolveSettings();
    expect(resolved.values).toEqual({
      novelty: 5,
      skepticism: 5,
      defaultPreset: undefined,
      defaultContext: undefined,
      markdownOnly: false,
      modelPolicy: 'latest',
      sources: { file: undefined, scouts: undefined, web: 'auto' },
    });
    expect(Object.values(resolved.origins).every((origin) => origin === 'default')).toBe(true);
    expect(resolved.filePath).toBeUndefined();
  });

  it('gives flags precedence over the environment, and the environment over the file', () => {
    const resolved = resolveSettings({
      flags: { novelty: 'high' },
      env: {
        HYPOTHESIS_COUNCIL_NOVELTY: '1',
        HYPOTHESIS_COUNCIL_SKEPTICISM: 'low',
        HYPOTHESIS_COUNCIL_WEB: '',
      },
      file: {
        version: 1,
        novelty: 3,
        skepticism: 9,
        defaultPreset: 'quick',
        sources: { web: 'off', scouts: 'duck-a, duck-b' },
      },
      filePath: '/home/settings.json',
    });
    expect(resolved.values).toMatchObject({
      novelty: 8,
      skepticism: 2,
      defaultPreset: 'quick',
      sources: { web: 'off', scouts: ['duck-a', 'duck-b'] },
    });
    expect(resolved.origins).toMatchObject({
      novelty: 'flag',
      skepticism: 'env',
      defaultPreset: 'file',
      'sources.web': 'file',
      'sources.scouts': 'file',
      modelPolicy: 'default',
    });
    expect(resolved.filePath).toBe('/home/settings.json');
    expect(dialsFromSettings(resolved)).toEqual({
      novelty: 8,
      skepticism: 2,
      origins: { novelty: 'flag', skepticism: 'env' },
    });
  });

  it('rejects unknown file keys and names the offending environment variable', () => {
    expect(() => resolveSettings({ file: { novelti: 3 } })).toThrow();
    expect(() => resolveSettings({ env: { HYPOTHESIS_COUNCIL_SKEPTICISM: 'twelve' } })).toThrow(
      'HYPOTHESIS_COUNCIL_SKEPTICISM: skepticism must be an integer from 0 to 10'
    );
    expect(() => resolveSettings({ flags: { modelPolicy: 'newest' } })).toThrow(
      'modelPolicy must be one of latest, pinned'
    );
  });
});
