import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { ModelPolicy } from '../research/settings.js';
import {
  CURATED_LATEST,
  resolveModelChoice,
  type DiscoveredModel,
  type GeminiTier,
  type ModelSource,
  type ModelVendor,
  type ResolvedModel,
} from './model-selection.js';
import { explicitModelsFromEnvironment, type CouncilPreset } from './presets.js';

/**
 * Model discovery: asks each vendor CLI (or its own cache file) which models exist, keeps a
 * normalised copy in the session home, and never copies vendor credentials. Only read-only
 * listing commands are ever spawned.
 */

export const MODEL_CACHE_FILENAME = 'models-cache.json';
export const DEFAULT_MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 15_000;

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface CommandRunOptions {
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}

/** Runs one read-only vendor command; injected so tests never spawn anything. */
export type CommandRunner = (
  command: string,
  args: string[],
  options: CommandRunOptions
) => Promise<CommandResult>;

/** The default runner. Windows `.cmd`/`.bat` shims need a shell; everything else is spawned directly. */
export function createCommandRunner(): CommandRunner {
  return (command, args, options) =>
    new Promise((resolve, reject) => {
      const script = options.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
      const quote = (value: string) =>
        /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
      execFile(
        script ? quote(command) : command,
        script ? args.map(quote) : args,
        {
          env: options.env,
          timeout: options.timeoutMs,
          maxBuffer: 16 * 1024 * 1024,
          windowsHide: true,
          shell: script,
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
          if (error && 'killed' in error && error.killed) {
            reject(
              new Error(`${command} ${args.join(' ')} timed out after ${options.timeoutMs} ms`)
            );
            return;
          }
          const code =
            error && 'code' in error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
          if (error && stdout.length === 0) {
            reject(
              new Error(`${command} ${args.join(' ')} failed: ${error.message.split('\n')[0]}`)
            );
            return;
          }
          resolve({ stdout, stderr, code });
        }
      );
    });
}

export interface VendorDiscovery {
  vendor: ModelVendor;
  models: DiscoveredModel[];
  source: ModelSource;
  /** File or command the models came from. */
  detail?: string;
  fetchedAt: string;
  /** False when a stale cache or the curated table had to stand in. */
  fresh: boolean;
  error?: string;
}

export interface DiscoveryOptions {
  environment: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  homeDirectory: string;
  /** The Hypothesis Council cache, normally `<session home>/models-cache.json`. */
  cachePath: string;
  ttlMs?: number;
  refresh?: boolean;
  timeoutMs?: number;
  run: CommandRunner;
  locateCommand: (command: string) => string | undefined;
  now?: () => number;
}

interface CachedVendor {
  models: DiscoveredModel[];
  source: ModelSource;
  detail?: string;
  fetchedAt: string;
}

interface ModelCacheFile {
  version: 1;
  vendors: Partial<Record<ModelVendor, CachedVendor>>;
}

export function modelCachePath(root: string): string {
  return join(root, MODEL_CACHE_FILENAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no JSON object in output');
  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  if (!isRecord(parsed)) throw new Error('JSON output is not an object');
  return parsed;
}

function normaliseModel(value: unknown): DiscoveredModel | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.trim() === '') return undefined;
  const model: DiscoveredModel = { id: value.id };
  if (typeof value.displayName === 'string') model.displayName = value.displayName;
  if (typeof value.contextWindowTokens === 'number')
    model.contextWindowTokens = value.contextWindowTokens;
  if (value.hidden === true) model.hidden = true;
  if (typeof value.supersededBy === 'string') model.supersededBy = value.supersededBy;
  if (typeof value.priority === 'number') model.priority = value.priority;
  if (Array.isArray(value.reasoningLevels)) {
    model.reasoningLevels = value.reasoningLevels.filter(
      (level): level is string => typeof level === 'string'
    );
  }
  return model;
}

/** Read the Hypothesis Council cache; anything unreadable counts as empty. */
export function loadModelCache(path: string): ModelCacheFile {
  const empty: ModelCacheFile = { version: 1, vendors: {} };
  if (!existsSync(path)) return empty;
  try {
    const parsed = parseJsonObject(readFileSync(path, 'utf8'));
    if (parsed.version !== 1 || !isRecord(parsed.vendors)) return empty;
    const vendors: ModelCacheFile['vendors'] = {};
    for (const [key, value] of Object.entries(parsed.vendors)) {
      if (!isRecord(value) || typeof value.fetchedAt !== 'string' || !Array.isArray(value.models)) {
        continue;
      }
      vendors[key as ModelVendor] = {
        models: value.models.flatMap((entry) => normaliseModel(entry) ?? []),
        source: typeof value.source === 'string' ? (value.source as ModelSource) : 'hc-cache',
        detail: typeof value.detail === 'string' ? value.detail : undefined,
        fetchedAt: value.fetchedAt,
      };
    }
    return { version: 1, vendors };
  } catch {
    return empty;
  }
}

function writeModelCache(path: string, cache: ModelCacheFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(cache, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(temporary, path);
}

// ---------------------------------------------------------------------------------------------
// Vendor listing parsers. Each reads only the fields the council needs.

/** `codex debug models` output and `~/.codex/models_cache.json` share one shape. */
export function parseCodexCatalog(text: string): DiscoveredModel[] {
  const parsed = parseJsonObject(text);
  if (!Array.isArray(parsed.models)) throw new Error('codex catalog has no models array');
  return parsed.models.flatMap((entry): DiscoveredModel[] => {
    if (!isRecord(entry) || typeof entry.slug !== 'string') return [];
    const model: DiscoveredModel = { id: entry.slug };
    if (typeof entry.display_name === 'string') model.displayName = entry.display_name;
    if (entry.visibility !== undefined && entry.visibility !== 'list') model.hidden = true;
    if (isRecord(entry.upgrade) && typeof entry.upgrade.model === 'string') {
      model.supersededBy = entry.upgrade.model;
    }
    if (typeof entry.priority === 'number') model.priority = entry.priority;
    if (typeof entry.context_window === 'number') model.contextWindowTokens = entry.context_window;
    if (Array.isArray(entry.supported_reasoning_levels)) {
      model.reasoningLevels = entry.supported_reasoning_levels.flatMap((level) =>
        isRecord(level) && typeof level.effort === 'string' ? [level.effort] : []
      );
    }
    return [model];
  });
}

/** `~/.grok/models_cache.json`: read `info.{id,name,context_window,hidden,reasoning_efforts}` only. */
export function parseGrokCache(text: string): DiscoveredModel[] {
  const parsed = parseJsonObject(text);
  if (!isRecord(parsed.models)) throw new Error('grok cache has no models object');
  return Object.entries(parsed.models).flatMap(([key, value]): DiscoveredModel[] => {
    const info = isRecord(value) && isRecord(value.info) ? value.info : undefined;
    const model: DiscoveredModel = { id: typeof info?.id === 'string' ? info.id : key };
    if (typeof info?.name === 'string') model.displayName = info.name;
    if (typeof info?.context_window === 'number') model.contextWindowTokens = info.context_window;
    if (info?.hidden === true) model.hidden = true;
    if (Array.isArray(info?.reasoning_efforts)) {
      model.reasoningLevels = info.reasoning_efforts.flatMap((effort) =>
        isRecord(effort) && typeof effort.id === 'string' ? [effort.id] : []
      );
    }
    return [model];
  });
}

/** `grok models` prints `  * grok-4.6 (default)` and `  - grok-4.5` lines. */
export function parseGrokModelsOutput(text: string): DiscoveredModel[] {
  const models: DiscoveredModel[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*[*-]\s+(\S+)/);
    if (match) models.push({ id: match[1] });
  }
  if (models.length === 0) throw new Error('grok models listed no models');
  return models;
}

/** `agy models` prints `id<TAB>name` lines and includes non-Gemini ids, which are dropped. */
export function parseAgyModelsOutput(text: string): DiscoveredModel[] {
  const models: DiscoveredModel[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [id, name] = line.split('\t');
    if (!id || !name || !/^gemini-/i.test(id.trim())) continue;
    models.push({ id: id.trim(), displayName: name.trim() });
  }
  if (models.length === 0) throw new Error('agy models listed no Gemini models');
  return models;
}

/** Claude Code keeps concrete ids in `~/.claude.json` and an alias in `~/.claude/settings.json`. */
export function parseClaudeConfig(
  claudeJson: string | undefined,
  settingsJson: string | undefined
): DiscoveredModel[] {
  const models: DiscoveredModel[] = [];
  if (claudeJson) {
    const parsed = parseJsonObject(claudeJson);
    if (Array.isArray(parsed.additionalModelOptionsCache)) {
      for (const entry of parsed.additionalModelOptionsCache) {
        if (!isRecord(entry) || typeof entry.value !== 'string') continue;
        const model: DiscoveredModel = { id: entry.value };
        if (typeof entry.label === 'string') model.displayName = entry.label;
        models.push(model);
      }
    }
  }
  if (settingsJson) {
    const parsed = parseJsonObject(settingsJson);
    if (typeof parsed.model === 'string' && !models.some((model) => model.id === parsed.model)) {
      models.push({ id: parsed.model, displayName: 'settings.json model' });
    }
  }
  if (models.length === 0) throw new Error('no model ids in the Claude Code configuration');
  return models;
}

// ---------------------------------------------------------------------------------------------

interface VendorListing {
  models: DiscoveredModel[];
  source: ModelSource;
  detail: string;
}

interface ResolvedDiscoveryOptions extends DiscoveryOptions {
  ttlMs: number;
  timeoutMs: number;
  now: () => number;
}

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

function fileIsFresh(path: string, text: string, options: ResolvedDiscoveryOptions): boolean {
  let fetched: number | undefined;
  try {
    const stamp = parseJsonObject(text).fetched_at;
    if (typeof stamp === 'string') fetched = Date.parse(stamp);
  } catch {
    // Fall back to the file time below.
  }
  if (fetched === undefined || Number.isNaN(fetched)) fetched = statSync(path).mtimeMs;
  return options.now() - fetched <= options.ttlMs;
}

async function runListing(
  command: string,
  args: string[],
  options: ResolvedDiscoveryOptions
): Promise<string> {
  const path = options.locateCommand(command);
  if (!path) throw new Error(`${command} is not on PATH`);
  const result = await options.run(path, args, {
    timeoutMs: options.timeoutMs,
    env: options.environment,
    platform: options.platform,
  });
  if (result.stdout.trim() === '') {
    throw new Error(
      `${command} ${args.join(' ')} produced no output${result.code ? ` (exit ${result.code})` : ''}`
    );
  }
  return result.stdout;
}

async function discoverCodex(options: ResolvedDiscoveryOptions): Promise<VendorListing> {
  const cachePath = join(
    options.environment.CODEX_HOME || join(options.homeDirectory, '.codex'),
    'models_cache.json'
  );
  const cached = readIfExists(cachePath);
  if (cached && !options.refresh && fileIsFresh(cachePath, cached, options)) {
    return { models: parseCodexCatalog(cached), source: 'vendor-cache', detail: cachePath };
  }
  try {
    const output = await runListing('codex', ['debug', 'models'], options);
    return {
      models: parseCodexCatalog(output),
      source: 'vendor-command',
      detail: 'codex debug models',
    };
  } catch (error) {
    if (cached)
      return { models: parseCodexCatalog(cached), source: 'vendor-cache', detail: cachePath };
    throw error;
  }
}

async function discoverGrok(options: ResolvedDiscoveryOptions): Promise<VendorListing> {
  const cachePath = join(options.homeDirectory, '.grok', 'models_cache.json');
  const cached = readIfExists(cachePath);
  if (cached && !options.refresh && fileIsFresh(cachePath, cached, options)) {
    return { models: parseGrokCache(cached), source: 'vendor-cache', detail: cachePath };
  }
  try {
    const output = await runListing('grok', ['models'], options);
    return {
      models: parseGrokModelsOutput(output),
      source: 'vendor-command',
      detail: 'grok models',
    };
  } catch (error) {
    if (cached)
      return { models: parseGrokCache(cached), source: 'vendor-cache', detail: cachePath };
    throw error;
  }
}

async function discoverGemini(options: ResolvedDiscoveryOptions): Promise<VendorListing> {
  const output = await runListing('agy', ['models'], options);
  return { models: parseAgyModelsOutput(output), source: 'vendor-command', detail: 'agy models' };
}

function discoverClaude(options: ResolvedDiscoveryOptions): Promise<VendorListing> {
  const configDir = options.environment.CLAUDE_CONFIG_DIR;
  const claudeJsonPath = configDir
    ? join(configDir, '.claude.json')
    : join(options.homeDirectory, '.claude.json');
  const settingsPath = join(configDir || join(options.homeDirectory, '.claude'), 'settings.json');
  const models = parseClaudeConfig(readIfExists(claudeJsonPath), readIfExists(settingsPath));
  return Promise.resolve({
    models,
    source: 'vendor-config',
    detail: `${claudeJsonPath} + ${settingsPath}`,
  });
}

const VENDOR_DISCOVERY: Record<
  ModelVendor,
  (options: ResolvedDiscoveryOptions) => Promise<VendorListing>
> = {
  claude: discoverClaude,
  codex: discoverCodex,
  gemini: discoverGemini,
  grok: discoverGrok,
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} discovery timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Discover models for the given vendors in parallel. A fresh Hypothesis Council cache answers
 * without spawning; otherwise the vendor is asked and the cache updated. Failures fall back to
 * the stale cache, then to the curated table, and are reported in `error` rather than thrown.
 */
export async function discoverModels(
  vendors: readonly ModelVendor[],
  input: DiscoveryOptions
): Promise<Partial<Record<ModelVendor, VendorDiscovery>>> {
  const options: ResolvedDiscoveryOptions = {
    ...input,
    ttlMs:
      input.ttlMs ??
      positiveInteger(
        input.environment.HYPOTHESIS_COUNCIL_MODEL_CACHE_TTL_MS,
        DEFAULT_MODEL_CACHE_TTL_MS
      ),
    timeoutMs:
      input.timeoutMs ??
      positiveInteger(
        input.environment.HYPOTHESIS_COUNCIL_MODEL_DISCOVERY_TIMEOUT_MS,
        DEFAULT_DISCOVERY_TIMEOUT_MS
      ),
    now: input.now ?? Date.now,
  };
  const cache = loadModelCache(options.cachePath);
  const results: Partial<Record<ModelVendor, VendorDiscovery>> = {};
  let cacheChanged = false;

  await Promise.all(
    [...new Set(vendors)].map(async (vendor) => {
      const cached = cache.vendors[vendor];
      const cachedAge = cached
        ? options.now() - Date.parse(cached.fetchedAt)
        : Number.POSITIVE_INFINITY;
      if (cached && !options.refresh && cachedAge <= options.ttlMs) {
        results[vendor] = {
          vendor,
          models: cached.models,
          source: 'hc-cache',
          detail: cached.detail,
          fetchedAt: cached.fetchedAt,
          fresh: true,
        };
        return;
      }
      try {
        const listing = await withTimeout(
          VENDOR_DISCOVERY[vendor](options),
          options.timeoutMs,
          vendor
        );
        const fetchedAt = new Date(options.now()).toISOString();
        cache.vendors[vendor] = {
          models: listing.models,
          source: listing.source,
          detail: listing.detail,
          fetchedAt,
        };
        cacheChanged = true;
        results[vendor] = { vendor, ...listing, fetchedAt, fresh: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results[vendor] = cached
          ? {
              vendor,
              models: cached.models,
              source: 'hc-cache',
              detail: cached.detail,
              fetchedAt: cached.fetchedAt,
              fresh: false,
              error: message,
            }
          : {
              vendor,
              models: CURATED_LATEST[vendor].map((id) => ({ id })),
              source: 'curated',
              detail: 'curated table',
              fetchedAt: new Date(options.now()).toISOString(),
              fresh: false,
              error: message,
            };
      }
    })
  );

  if (cacheChanged) {
    try {
      writeModelCache(options.cachePath, cache);
    } catch {
      // A read-only session home must not break a run; the listing still works this time.
    }
  }
  return results;
}

export interface CouncilModelOptions {
  policy: ModelPolicy;
  /** `--model KEY=ID` values keyed by slot. */
  explicit?: Record<string, string>;
  /** The process environment before any preset ran; `*_DEFAULT_MODEL` values there are explicit. */
  snapshot?: NodeJS.ProcessEnv;
  discovery: DiscoveryOptions;
}

export interface CouncilModels {
  models: Record<string, ResolvedModel>;
  discoveries: Partial<Record<ModelVendor, VendorDiscovery>>;
}

function geminiTierPreference(environment: NodeJS.ProcessEnv): GeminiTier | undefined {
  const value = environment.HYPOTHESIS_COUNCIL_MODEL_FAMILY_GEMINI?.trim().toLowerCase();
  return value === 'pro' || value === 'flash' ? value : undefined;
}

/**
 * Resolve every model slot of a preset. Slots with an explicit id, and every slot under the
 * `pinned` policy, never trigger discovery; the rest share one parallel discovery pass.
 */
export async function resolveCouncilModels(
  preset: CouncilPreset,
  options: CouncilModelOptions
): Promise<CouncilModels> {
  const slots = preset.modelSlots ?? [];
  const fromEnvironment = options.snapshot
    ? explicitModelsFromEnvironment(options.snapshot, preset)
    : {};
  const explicitFor = (key: string) => options.explicit?.[key] ?? fromEnvironment[key];
  const vendors = slots
    .filter((slot) => !explicitFor(slot.key) && options.policy === 'latest')
    .map((slot) => slot.vendor);
  const discoveries = vendors.length > 0 ? await discoverModels(vendors, options.discovery) : {};
  const preferGeminiTier = geminiTierPreference(options.discovery.environment);
  const models: Record<string, ResolvedModel> = {};
  for (const slot of slots) {
    const discovery = discoveries[slot.vendor];
    models[slot.key] = resolveModelChoice({
      vendor: slot.vendor,
      policy: options.policy,
      pinned: slot.pinned,
      pinnedContextTokens: slot.pinnedContextTokens,
      explicit: explicitFor(slot.key),
      discovered: discovery && discovery.source !== 'curated' ? discovery.models : [],
      source: discovery?.source,
      discoveryError: discovery?.error,
      preferGeminiTier,
    });
  }
  return { models, discoveries };
}
