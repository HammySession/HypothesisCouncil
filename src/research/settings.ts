import { z } from 'zod';

/**
 * User settings for the council: the novelty and skepticism dials plus a few defaults. This module
 * owns the schema and the precedence rule (command flag > environment variable > settings file >
 * default); reading and writing the file lives in `settings-store.ts`.
 */

export const SETTINGS_VERSION = 1;
export const DIAL_MIN = 0;
export const DIAL_MAX = 10;
export const DEFAULT_DIAL = 5;

/** Named dial levels accepted wherever a number is. */
export const DIAL_ALIASES: Readonly<Record<string, number>> = { low: 2, medium: 5, high: 8 };

export interface DialSettings {
  /** 0 = plausibility first, 5 = balanced, 10 = contradict the dominant explanation. */
  novelty: number;
  /** 0 = credit well-known results, 5 = balanced, 10 = distrust every unverified claim. */
  skepticism: number;
}

export const DEFAULT_DIALS: Readonly<DialSettings> = {
  novelty: DEFAULT_DIAL,
  skepticism: DEFAULT_DIAL,
};

export type SettingOrigin = 'flag' | 'env' | 'file' | 'default';

/** Dial values together with where each one came from; persisted on the session. */
export interface DialConfig extends DialSettings {
  origins: Record<keyof DialSettings, SettingOrigin>;
}

/** Dial values a caller may pass to a run; missing values fall back to the default level. */
export interface DialInput {
  novelty?: number;
  skepticism?: number;
  origins?: Partial<Record<keyof DialSettings, SettingOrigin>>;
}

export function parseDial(value: unknown, name = 'dial'): number {
  let candidate: unknown = value;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    candidate = text === '' ? undefined : (DIAL_ALIASES[text] ?? Number(text));
  }
  if (
    typeof candidate !== 'number' ||
    !Number.isInteger(candidate) ||
    candidate < DIAL_MIN ||
    candidate > DIAL_MAX
  ) {
    throw new Error(
      `${name} must be an integer from ${DIAL_MIN} to ${DIAL_MAX} or one of ${Object.keys(DIAL_ALIASES).join(', ')} (got ${JSON.stringify(value)})`
    );
  }
  return candidate;
}

export function dialLabel(level: number): 'low' | 'medium' | 'high' {
  if (level <= 2) return 'low';
  if (level >= 8) return 'high';
  return 'medium';
}

export function describeDials(dials: DialSettings): string {
  return `novelty ${dials.novelty}/10 (${dialLabel(dials.novelty)}) · skepticism ${dials.skepticism}/10 (${dialLabel(dials.skepticism)})`;
}

/** Turn a run-level dial input into persisted values with origins. */
export function dialConfigFrom(input: DialInput | undefined): DialConfig {
  const originOf = (key: keyof DialSettings): SettingOrigin =>
    input?.origins?.[key] ?? (input?.[key] === undefined ? 'default' : 'flag');
  return {
    novelty: parseDial(input?.novelty ?? DEFAULT_DIAL, 'novelty'),
    skepticism: parseDial(input?.skepticism ?? DEFAULT_DIAL, 'skepticism'),
    origins: { novelty: originOf('novelty'), skepticism: originOf('skepticism') },
  };
}

export const DialSchema = z.union([z.number(), z.string()]).transform((value, context) => {
  try {
    return parseDial(value);
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : String(error),
    });
    return z.NEVER;
  }
});

export const WEB_MODES = ['auto', 'on', 'off'] as const;
export type WebMode = (typeof WEB_MODES)[number];

export const MODEL_POLICIES = ['latest', 'pinned'] as const;
export type ModelPolicy = (typeof MODEL_POLICIES)[number];

function toList(value: string[] | string): string[] {
  const items = Array.isArray(value) ? value : value.split(',');
  return items.map((item) => item.trim()).filter(Boolean);
}

const StringListSchema = z.union([z.array(z.string()), z.string()]).transform(toList);

const BooleanSchema = z.union([z.boolean(), z.string()]).transform((value, context) => {
  if (typeof value === 'boolean') return value;
  const text = value.trim().toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(text)) return true;
  if (['false', 'no', 'off', '0'].includes(text)) return false;
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: `expected true or false, got "${value}"`,
  });
  return z.NEVER;
});

export const SourcesSettingsSchema = z
  .object({
    file: z.string().min(1).optional(),
    scouts: StringListSchema.optional(),
    web: z.enum(WEB_MODES).optional(),
  })
  .strict();

/** The settings file: every key optional, unknown keys rejected. */
export const CouncilSettingsFileSchema = z
  .object({
    version: z.literal(SETTINGS_VERSION).optional(),
    novelty: DialSchema.optional(),
    skepticism: DialSchema.optional(),
    defaultPreset: z.string().min(1).optional(),
    defaultContext: StringListSchema.optional(),
    markdownOnly: BooleanSchema.optional(),
    modelPolicy: z.enum(MODEL_POLICIES).optional(),
    sources: SourcesSettingsSchema.optional(),
  })
  .strict();

export type SettingsFile = z.infer<typeof CouncilSettingsFileSchema>;

/** Fully resolved settings with defaults applied. */
export interface CouncilSettings {
  novelty: number;
  skepticism: number;
  defaultPreset?: string;
  defaultContext?: string[];
  markdownOnly: boolean;
  modelPolicy: ModelPolicy;
  sources: {
    file?: string;
    scouts?: string[];
    web: WebMode;
  };
}

export const SETTING_KEYS = [
  'novelty',
  'skepticism',
  'defaultPreset',
  'defaultContext',
  'markdownOnly',
  'modelPolicy',
  'sources.file',
  'sources.scouts',
  'sources.web',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export const SETTING_ENV: Readonly<Partial<Record<SettingKey, string>>> = {
  novelty: 'HYPOTHESIS_COUNCIL_NOVELTY',
  skepticism: 'HYPOTHESIS_COUNCIL_SKEPTICISM',
  defaultPreset: 'HYPOTHESIS_COUNCIL_PRESET',
  modelPolicy: 'HYPOTHESIS_COUNCIL_MODEL_POLICY',
  'sources.file': 'HYPOTHESIS_COUNCIL_SOURCES',
  'sources.scouts': 'HYPOTHESIS_COUNCIL_SCOUTS',
  'sources.web': 'HYPOTHESIS_COUNCIL_WEB',
};

/** One-line help per key, shown by the settings commands. */
export const SETTING_HELP: Readonly<Record<SettingKey, string>> = {
  novelty: '0-10 or low/medium/high; how far hypotheses may stray from the dominant explanation',
  skepticism: '0-10 or low/medium/high; how much scrutiny evidence receives',
  defaultPreset: 'council preset used when a run names none',
  defaultContext: 'comma-separated context paths used when a run names none',
  markdownOnly: 'true to send only Markdown and MDX files by default',
  modelPolicy: 'latest (auto-select the newest model per vendor) or pinned',
  'sources.file': 'default sources file for the sources stage',
  'sources.scouts': 'comma-separated scout provider names for web scouting',
  'sources.web': 'auto, on, or off',
};

type SettingValue = string | number | boolean | string[];

const parsers: Record<SettingKey, (value: unknown) => SettingValue> = {
  novelty: (value) => parseDial(value, 'novelty'),
  skepticism: (value) => parseDial(value, 'skepticism'),
  defaultPreset: (value) => parseText(value, 'defaultPreset'),
  defaultContext: (value) => parseList(value, 'defaultContext'),
  markdownOnly: (value) => parseBoolean(value, 'markdownOnly'),
  modelPolicy: (value) => parseChoice(value, 'modelPolicy', MODEL_POLICIES),
  'sources.file': (value) => parseText(value, 'sources.file'),
  'sources.scouts': (value) => parseList(value, 'sources.scouts'),
  'sources.web': (value) => parseChoice(value, 'sources.web', WEB_MODES),
};

function parseText(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function parseList(value: unknown, key: string): string[] {
  const list =
    typeof value === 'string'
      ? toList(value)
      : Array.isArray(value)
        ? toList(value.filter((entry): entry is string => typeof entry === 'string'))
        : [];
  if (list.length > 0 && (!Array.isArray(value) || list.length === value.length)) return list;
  throw new Error(`${key} must be a comma-separated list or an array of strings`);
}

function parseBoolean(value: unknown, key: string): boolean {
  const result = BooleanSchema.safeParse(value);
  if (!result.success) throw new Error(`${key} must be true or false`);
  return result.data;
}

function parseChoice<T extends string>(value: unknown, key: string, choices: readonly T[]): T {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : value;
  if (typeof text === 'string' && (choices as readonly string[]).includes(text)) return text as T;
  throw new Error(`${key} must be one of ${choices.join(', ')} (got ${JSON.stringify(value)})`);
}

/** Validate one value for a key, using the same rules as the file schema. */
export function parseSettingValue(key: SettingKey, value: unknown): SettingValue {
  return parsers[key](value);
}

/** Accept `novelty`, `default-preset`, `SOURCES.WEB`, and similar spellings of a known key. */
export function normalizeSettingKey(input: string): SettingKey {
  const wanted = input.trim().toLowerCase().replace(/[-_]/g, '');
  const match = SETTING_KEYS.find((key) => key.toLowerCase().replace(/[-_]/g, '') === wanted);
  if (!match) {
    throw new Error(`Unknown setting: ${input}. Known settings: ${SETTING_KEYS.join(', ')}`);
  }
  return match;
}

export interface SettingsSources {
  /** Values given on the command line or tool call, already split from their flags. */
  flags?: Partial<Record<SettingKey, unknown>>;
  env?: NodeJS.ProcessEnv;
  /** Parsed settings file contents (raw JSON is accepted and validated). */
  file?: unknown;
  filePath?: string;
}

export interface ResolvedSettings {
  values: CouncilSettings;
  origins: Record<SettingKey, SettingOrigin>;
  filePath?: string;
}

function fileLeaf(file: SettingsFile, key: SettingKey): unknown {
  switch (key) {
    case 'sources.file':
      return file.sources?.file;
    case 'sources.scouts':
      return file.sources?.scouts;
    case 'sources.web':
      return file.sources?.web;
    default:
      return file[key];
  }
}

/**
 * Resolve every setting with the precedence flag > env > file > default and record where each
 * value came from. The file is validated strictly so a typo cannot silently fall back to a default.
 */
export function resolveSettings(sources: SettingsSources = {}): ResolvedSettings {
  const file = CouncilSettingsFileSchema.parse(sources.file ?? {});
  const env = sources.env ?? {};
  const resolved = {} as Record<SettingKey, SettingValue | undefined>;
  const origins = {} as Record<SettingKey, SettingOrigin>;

  for (const key of SETTING_KEYS) {
    const flagValue = sources.flags?.[key];
    const envName = SETTING_ENV[key];
    const envValue = envName ? env[envName] : undefined;
    const fileValue = fileLeaf(file, key);
    if (flagValue !== undefined) {
      resolved[key] = parseSettingValue(key, flagValue);
      origins[key] = 'flag';
    } else if (envValue !== undefined && envValue.trim() !== '') {
      try {
        resolved[key] = parseSettingValue(key, envValue);
      } catch (error) {
        throw new Error(`${envName}: ${error instanceof Error ? error.message : String(error)}`);
      }
      origins[key] = 'env';
    } else if (fileValue !== undefined) {
      resolved[key] = parseSettingValue(key, fileValue);
      origins[key] = 'file';
    } else {
      resolved[key] = undefined;
      origins[key] = 'default';
    }
  }

  const values: CouncilSettings = {
    novelty: (resolved.novelty as number | undefined) ?? DEFAULT_DIAL,
    skepticism: (resolved.skepticism as number | undefined) ?? DEFAULT_DIAL,
    defaultPreset: resolved.defaultPreset as string | undefined,
    defaultContext: resolved.defaultContext as string[] | undefined,
    markdownOnly: (resolved.markdownOnly as boolean | undefined) ?? false,
    modelPolicy: (resolved.modelPolicy as ModelPolicy | undefined) ?? 'latest',
    sources: {
      file: resolved['sources.file'] as string | undefined,
      scouts: resolved['sources.scouts'] as string[] | undefined,
      web: (resolved['sources.web'] as WebMode | undefined) ?? 'auto',
    },
  };
  return { values, origins, filePath: sources.filePath };
}

/** The dial values of a resolved settings object, with their origins. */
export function dialsFromSettings(resolved: ResolvedSettings): DialConfig {
  return {
    novelty: resolved.values.novelty,
    skepticism: resolved.values.skepticism,
    origins: { novelty: resolved.origins.novelty, skepticism: resolved.origins.skepticism },
  };
}
