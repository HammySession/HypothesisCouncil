import {
  parseSettingsArgs,
  renderSettingValue,
  settingsHelpText,
  settingsJson,
  settingsRows,
  settingsText,
} from '../../src/cli/settings-view.js';
import { resolveSettings } from '../../src/research/settings.js';

describe('settings view', () => {
  const resolved = resolveSettings({
    flags: { novelty: 9 },
    env: { HYPOTHESIS_COUNCIL_SKEPTICISM: 'high' },
    file: { defaultContext: ['src', 'docs'], sources: { web: 'off' } },
    filePath: '/home/hc/settings.json',
  });

  it('renders values with their origins', () => {
    expect(renderSettingValue(undefined)).toBe('(unset)');
    expect(renderSettingValue(['a', 'b'])).toBe('a, b');
    expect(renderSettingValue(false)).toBe('false');

    const rows = settingsRows(resolved);
    expect(rows).toContainEqual({ key: 'novelty', value: '9', origin: 'flag' });
    expect(rows).toContainEqual({
      key: 'skepticism',
      value: '8',
      origin: 'env HYPOTHESIS_COUNCIL_SKEPTICISM',
    });
    expect(rows).toContainEqual({ key: 'defaultContext', value: 'src, docs', origin: 'file' });
    expect(rows).toContainEqual({ key: 'sources.web', value: 'off', origin: 'file' });
    expect(rows).toContainEqual({ key: 'modelPolicy', value: 'latest', origin: 'default' });
    expect(rows).toContainEqual({ key: 'defaultPreset', value: '(unset)', origin: 'default' });
  });

  it('prints a table, the file path, the precedence rule, and extra rows', () => {
    const text = settingsText(resolved, [
      { key: 'models.claude', value: 'claude-x', origin: 'discovered' },
    ]);
    expect(text.split('\n')[0]).toMatch(/^SETTING\s+VALUE\s+ORIGIN$/);
    expect(text).toMatch(/novelty\s+9\s+flag/);
    expect(text).toMatch(/models\.claude\s+claude-x\s+discovered/);
    expect(text).toContain('Settings file: /home/hc/settings.json');
    expect(text).toContain(
      'Precedence: command flag > environment variable > settings file > default.'
    );
    expect(settingsHelpText()).toContain('HYPOTHESIS_COUNCIL_NOVELTY');
    expect(settingsJson(resolved)).toEqual({
      values: resolved.values,
      origins: resolved.origins,
      filePath: '/home/hc/settings.json',
    });
  });

  it('parses settings sub-commands', () => {
    expect(parseSettingsArgs([])).toEqual({ kind: 'show', json: false });
    expect(parseSettingsArgs(['--json'])).toEqual({ kind: 'show', json: true });
    expect(parseSettingsArgs(['show', '--json'])).toEqual({ kind: 'show', json: true });
    expect(parseSettingsArgs(['help'])).toEqual({ kind: 'help' });
    expect(parseSettingsArgs(['path'])).toEqual({ kind: 'path' });
    expect(parseSettingsArgs(['reset'])).toEqual({ kind: 'reset' });
    expect(parseSettingsArgs(['set', 'novelty', 'high'])).toEqual({
      kind: 'set',
      key: 'novelty',
      value: 'high',
    });
    expect(parseSettingsArgs(['set', 'novelty=8'])).toEqual({
      kind: 'set',
      key: 'novelty',
      value: '8',
    });
    expect(parseSettingsArgs(['set', 'defaultContext', 'src,', 'docs'])).toEqual({
      kind: 'set',
      key: 'defaultContext',
      value: 'src, docs',
    });
    expect(parseSettingsArgs(['unset', 'novelty'])).toEqual({ kind: 'unset', key: 'novelty' });
    expect(() => parseSettingsArgs(['set'])).toThrow('Usage: hc settings');
    expect(() => parseSettingsArgs(['set', 'novelty'])).toThrow('Missing value for novelty');
    expect(() => parseSettingsArgs(['unset'])).toThrow('Usage: hc settings');
    expect(() => parseSettingsArgs(['bogus'])).toThrow('Unknown settings command: bogus');
  });
});
