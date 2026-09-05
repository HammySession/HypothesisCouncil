import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadSettingsFile,
  resetSettingsFile,
  saveSettingsFile,
  setSetting,
  settingsPath,
  unsetSetting,
} from '../../src/research/settings-store.js';

function freshPath(): string {
  return settingsPath(mkdtempSync(join(tmpdir(), 'hc-settings-')));
}

describe('settings store', () => {
  it('treats a missing file as empty and writes a versioned file with private permissions', () => {
    const path = freshPath();
    expect(path.endsWith('settings.json')).toBe(true);
    expect(loadSettingsFile(path)).toEqual({});

    const written = saveSettingsFile(path, { novelty: 'high', 'sources.web': 'off' });
    expect(written).toEqual({ version: 1, novelty: 8, sources: { web: 'off' } });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      version: 1,
      novelty: 8,
      sources: { web: 'off' },
    });
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('sets, unsets, and resets individual keys', () => {
    const path = freshPath();
    expect(setSetting(path, 'default-preset', 'quick')).toMatchObject({
      key: 'defaultPreset',
      value: 'quick',
    });
    expect(setSetting(path, 'sources.scouts', 'a, b').value).toEqual(['a', 'b']);
    expect(loadSettingsFile(path)).toEqual({
      version: 1,
      defaultPreset: 'quick',
      sources: { scouts: ['a', 'b'] },
    });
    expect(unsetSetting(path, 'sources.scouts').file).toEqual({
      version: 1,
      defaultPreset: 'quick',
    });
    expect(unsetSetting(path, 'novelty').file).toEqual({ version: 1, defaultPreset: 'quick' });
    expect(resetSettingsFile(path)).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(resetSettingsFile(path)).toBe(false);
  });

  it('rejects invalid values before touching the file', () => {
    const path = freshPath();
    expect(() => setSetting(path, 'novelty', '42')).toThrow(
      'novelty must be an integer from 0 to 10'
    );
    expect(() => setSetting(path, 'wat', '1')).toThrow('Unknown setting: wat');
    expect(existsSync(path)).toBe(false);
  });

  it('explains a corrupt or invalid file and how to reset it', () => {
    const path = freshPath();
    writeFileSync(path, '{ not json');
    expect(() => loadSettingsFile(path)).toThrow(`Settings file ${path} is not valid JSON`);
    expect(() => loadSettingsFile(path)).toThrow('hc settings reset');

    writeFileSync(path, JSON.stringify({ novelty: 'extreme', bogus: true }));
    expect(() => loadSettingsFile(path)).toThrow(`Settings file ${path} is invalid (`);
    expect(() => loadSettingsFile(path)).toThrow('novelty:');
  });
});
