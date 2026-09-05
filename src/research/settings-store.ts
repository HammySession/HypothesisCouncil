import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import {
  CouncilSettingsFileSchema,
  SETTINGS_VERSION,
  normalizeSettingKey,
  parseSettingValue,
  type SettingKey,
  type SettingsFile,
} from './settings.js';

export const SETTINGS_FILENAME = 'settings.json';
export const SETTINGS_RESET_HINT =
  'Run `hc settings reset` to discard it, or fix the JSON by hand.';

export function settingsPath(root: string): string {
  return join(root, SETTINGS_FILENAME);
}

/** A flat patch keyed by setting name, for example `{ novelty: 8, 'sources.web': 'off' }`. */
export type SettingsPatch = Partial<Record<SettingKey, unknown>>;

/** Read and validate the settings file; a missing file is an empty object. */
export function loadSettingsFile(path: string): SettingsFile {
  if (!existsSync(path)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `Settings file ${path} is not valid JSON (${error instanceof Error ? error.message : String(error)}). ${SETTINGS_RESET_HINT}`
    );
  }
  const parsed = CouncilSettingsFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Settings file ${path} is invalid (${issues}). ${SETTINGS_RESET_HINT}`);
  }
  return parsed.data;
}

function atomicWrite(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
}

function writeSettingsFile(path: string, file: SettingsFile): SettingsFile {
  const { version: _version, ...rest } = file;
  const output: SettingsFile = { version: SETTINGS_VERSION, ...rest };
  if (output.sources && Object.keys(output.sources).length === 0) delete output.sources;
  atomicWrite(path, `${JSON.stringify(output, null, 2)}\n`);
  return output;
}

function applyPatch(file: SettingsFile, patch: SettingsPatch): SettingsFile {
  const next: SettingsFile = { ...file, sources: file.sources ? { ...file.sources } : undefined };
  if (!next.sources) delete next.sources;
  for (const [rawKey, rawValue] of Object.entries(patch)) {
    if (rawValue === undefined) continue;
    const key = normalizeSettingKey(rawKey);
    const value = parseSettingValue(key, rawValue);
    if (key.startsWith('sources.')) {
      const leaf = key.slice('sources.'.length) as 'file' | 'scouts' | 'web';
      next.sources = { ...(next.sources ?? {}), [leaf]: value };
    } else {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}

/** Validate and merge a patch into the settings file, then write it atomically (mode 0600). */
export function saveSettingsFile(path: string, patch: SettingsPatch): SettingsFile {
  return writeSettingsFile(path, applyPatch(loadSettingsFile(path), patch));
}

/** Set one key from a raw (typically string) value; returns the normalized key and parsed value. */
export function setSetting(
  path: string,
  rawKey: string,
  rawValue: unknown
): { key: SettingKey; value: unknown; file: SettingsFile } {
  const key = normalizeSettingKey(rawKey);
  const value = parseSettingValue(key, rawValue);
  const file = saveSettingsFile(path, { [key]: value });
  return { key, value, file };
}

/** Remove one key from the settings file; a key that is not set is not an error. */
export function unsetSetting(
  path: string,
  rawKey: string
): { key: SettingKey; file: SettingsFile } {
  const key = normalizeSettingKey(rawKey);
  const file = loadSettingsFile(path);
  if (key.startsWith('sources.')) {
    if (file.sources) {
      delete file.sources[key.slice('sources.'.length) as 'file' | 'scouts' | 'web'];
      if (Object.keys(file.sources).length === 0) delete file.sources;
    }
  } else {
    delete (file as Record<string, unknown>)[key];
  }
  return { key, file: writeSettingsFile(path, file) };
}

/** Delete the settings file; returns whether one existed. */
export function resetSettingsFile(path: string): boolean {
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}
