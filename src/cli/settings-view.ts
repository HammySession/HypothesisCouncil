import {
  SETTING_ENV,
  SETTING_HELP,
  SETTING_KEYS,
  type ResolvedSettings,
  type SettingKey,
} from '../research/settings.js';
import { table } from './format.js';

export interface SettingsRow {
  key: string;
  value: string;
  origin: string;
}

export function renderSettingValue(value: unknown): string {
  if (value === undefined || value === null) return '(unset)';
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function settingValue(resolved: ResolvedSettings, key: SettingKey): unknown {
  const { values } = resolved;
  switch (key) {
    case 'sources.file':
      return values.sources.file;
    case 'sources.scouts':
      return values.sources.scouts;
    case 'sources.web':
      return values.sources.web;
    default:
      return values[key];
  }
}

/** `flag`, `env HYPOTHESIS_COUNCIL_NOVELTY`, `file`, or `default`. */
export function describeOrigin(resolved: ResolvedSettings, key: SettingKey): string {
  const origin = resolved.origins[key];
  if (origin === 'env') return `env ${SETTING_ENV[key] ?? ''}`.trim();
  return origin;
}

export function settingsRows(resolved: ResolvedSettings): SettingsRow[] {
  return SETTING_KEYS.map((key) => ({
    key,
    value: renderSettingValue(settingValue(resolved, key)),
    origin: describeOrigin(resolved, key),
  }));
}

/** The settings table plus file path and precedence; `extras` rows are appended (models, preset). */
export function settingsText(resolved: ResolvedSettings, extras: SettingsRow[] = []): string {
  const rows = [...settingsRows(resolved), ...extras].map((row) => [
    row.key,
    row.value,
    row.origin,
  ]);
  return [
    ...table(['SETTING', 'VALUE', 'ORIGIN'], rows),
    '',
    `Settings file: ${resolved.filePath ?? '(none)'}`,
    'Precedence: command flag > environment variable > settings file > default.',
    'Change a value with `hc settings set KEY VALUE` (or /set KEY VALUE in the shell); `hc settings help` lists the keys.',
  ].join('\n');
}

export function settingsHelpText(): string {
  return [
    'Settings:',
    ...table(
      ['KEY', 'MEANING', 'ENV'],
      SETTING_KEYS.map((key) => [key, SETTING_HELP[key], SETTING_ENV[key] ?? ''])
    ).map((line) => `  ${line}`),
  ].join('\n');
}

export function settingsJson(resolved: ResolvedSettings): Record<string, unknown> {
  return { values: resolved.values, origins: resolved.origins, filePath: resolved.filePath };
}

export type SettingsAction =
  | { kind: 'show'; json: boolean }
  | { kind: 'help' }
  | { kind: 'set'; key: string; value: string }
  | { kind: 'unset'; key: string }
  | { kind: 'path' }
  | { kind: 'reset' };

export const SETTINGS_USAGE =
  'Usage: hc settings [--json] | hc settings set KEY VALUE | hc settings unset KEY | hc settings path | hc settings reset | hc settings help';

/** Parse the words after `hc settings` (or the arguments of `/set` and `/unset`). */
export function parseSettingsArgs(args: string[]): SettingsAction {
  const json = args.includes('--json');
  const [verb, key, ...rest] = args.filter((argument) => argument !== '--json');
  if (!verb || verb === 'show' || verb === 'list') return { kind: 'show', json };
  if (verb === 'help') return { kind: 'help' };
  if (verb === 'path') return { kind: 'path' };
  if (verb === 'reset') return { kind: 'reset' };
  if (verb === 'set') {
    if (!key) throw new Error(SETTINGS_USAGE);
    const separator = key.indexOf('=');
    const name = separator > 0 ? key.slice(0, separator) : key;
    const value = (separator > 0 ? [key.slice(separator + 1), ...rest] : rest).join(' ').trim();
    if (!value) throw new Error(`${SETTINGS_USAGE}\nMissing value for ${name}`);
    return { kind: 'set', key: name, value };
  }
  if (verb === 'unset') {
    if (!key || rest.length > 0) throw new Error(SETTINGS_USAGE);
    return { kind: 'unset', key };
  }
  throw new Error(`Unknown settings command: ${verb}\n${SETTINGS_USAGE}`);
}
