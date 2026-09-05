import {
  SETTING_ENV,
  dialsFromSettings,
  resolveSettings,
  type DialConfig,
  type ResolvedSettings,
  type SettingKey,
} from '../research/settings.js';
import {
  loadSettingsFile,
  resetSettingsFile,
  setSetting,
  settingsPath,
  unsetSetting,
} from '../research/settings-store.js';
import {
  flag,
  flagValues,
  hasFlag,
  listFlag,
  pathFlag,
  valueFlag,
  type ParsedArguments,
} from './arguments.js';
import type { CliDependencies } from './dependencies.js';
import {
  renderSettingValue,
  settingsHelpText,
  settingsJson,
  settingsText,
  type SettingsAction,
  type SettingsRow,
} from './settings-view.js';

/** Resolve settings from the session home's file, the environment, and optional flag values. */
export function resolveStoreSettings(
  store: { root: string },
  env: NodeJS.ProcessEnv,
  flags?: Partial<Record<SettingKey, unknown>>
): ResolvedSettings {
  const filePath = settingsPath(store.root);
  return resolveSettings({ flags, env, file: loadSettingsFile(filePath), filePath });
}

/** The effective dials (environment and file) without any run flags. */
export function currentDials(store: { root: string }, env: NodeJS.ProcessEnv): DialConfig {
  return dialsFromSettings(resolveStoreSettings(store, env));
}

const DIAL_EXPECTATION = '0-10 or low, medium, high';

/** Settings-related values given on an `hc run` line; undefined entries fall through to env/file. */
export function settingsFlags(parsed: ParsedArguments): Partial<Record<SettingKey, unknown>> {
  const context = flagValues(parsed, '--context');
  const preset = flag(parsed, '--preset');
  return {
    novelty: valueFlag(parsed, '--novelty', DIAL_EXPECTATION),
    skepticism: valueFlag(parsed, '--skepticism', DIAL_EXPECTATION),
    defaultPreset: preset === 'true' ? undefined : preset,
    defaultContext: context.length > 0 ? context : undefined,
    markdownOnly: hasFlag(parsed, '--markdown-only') ? true : undefined,
    modelPolicy: valueFlag(parsed, '--model-policy', 'latest or pinned'),
    'sources.file': pathFlag(parsed, '--sources'),
    'sources.scouts': listFlag(parsed, '--scouts'),
    'sources.web': valueFlag(parsed, '--web', 'auto, on, or off'),
  };
}

/** Extra rows (preset, models, shell state) as a nested JSON object keyed by dotted names. */
export function settingsExtrasJson(extras: SettingsRow[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const row of extras) {
    const [head, ...rest] = row.key.split('.');
    if (rest.length === 0) {
      result[head] = { value: row.value, origin: row.origin };
      continue;
    }
    const group = (result[head] ??= {}) as Record<string, unknown>;
    group[rest.join('.')] = { value: row.value, origin: row.origin };
  }
  return result;
}

function warnWhenShadowed(key: SettingKey, deps: Pick<CliDependencies, 'env' | 'io'>): void {
  const name = SETTING_ENV[key];
  const value = name ? deps.env[name] : undefined;
  if (name && value !== undefined && value.trim() !== '') {
    deps.io.err(
      `Warning: ${name}=${value} is set in the environment and takes precedence over the settings file.`
    );
  }
}

/** Shared by `hc settings` and the `/settings`, `/set`, and `/unset` shell commands. */
export function executeSettings(
  action: SettingsAction,
  store: { root: string },
  deps: Pick<CliDependencies, 'env' | 'io'>,
  extras: SettingsRow[] = []
): number {
  const path = settingsPath(store.root);
  const { io } = deps;
  switch (action.kind) {
    case 'show': {
      const resolved = resolveStoreSettings(store, deps.env);
      io.out(
        action.json
          ? JSON.stringify({ ...settingsJson(resolved), ...settingsExtrasJson(extras) }, null, 2)
          : settingsText(resolved, extras)
      );
      return 0;
    }
    case 'help':
      io.out(settingsHelpText());
      return 0;
    case 'path':
      io.out(path);
      return 0;
    case 'reset':
      io.out(
        resetSettingsFile(path) ? `Settings reset; removed ${path}` : `No settings file at ${path}`
      );
      return 0;
    case 'set': {
      const { key, value } = setSetting(path, action.key, action.value);
      io.out(`Set ${key} = ${renderSettingValue(value)} in ${path}`);
      warnWhenShadowed(key, deps);
      return 0;
    }
    case 'unset': {
      const { key } = unsetSetting(path, action.key);
      io.out(`Unset ${key} in ${path}`);
      return 0;
    }
  }
}
