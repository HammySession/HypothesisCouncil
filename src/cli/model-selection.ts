import type { ModelPolicy } from '../research/settings.js';

/**
 * Pure model ranking: turns vendor model listings into one "latest" pick per vendor and applies
 * the precedence explicit > discovered latest > preset pin > curated table. No IO lives here;
 * discovery (`model-discovery.ts`) feeds it and presets consume its result.
 */

export type ModelVendor = 'claude' | 'codex' | 'gemini' | 'grok';
export const MODEL_VENDORS: readonly ModelVendor[] = ['claude', 'codex', 'gemini', 'grok'];

/** Where a vendor's model list came from. */
export type ModelSource =
  | 'vendor-cache'
  | 'vendor-command'
  | 'vendor-config'
  | 'hc-cache'
  | 'curated';

export type ModelOrigin = 'explicit' | 'latest' | 'pinned' | 'fallback';

export type GeminiTier = 'pro' | 'flash';

export interface DiscoveredModel {
  id: string;
  displayName?: string;
  contextWindowTokens?: number;
  /** Listed by the vendor but not offered to users (Codex `visibility: hide`, Grok `hidden`). */
  hidden?: boolean;
  /** The vendor points users at a newer id (Codex `upgrade.model`). */
  supersededBy?: string;
  /** Vendor ordering hint; lower is better (Codex `priority`). */
  priority?: number;
  reasoningLevels?: string[];
}

export interface ParsedModelId {
  vendor?: ModelVendor;
  family: string;
  version: number[];
  tier?: string;
  effort?: string;
  contextSuffix?: string;
  excludedVariant?: string;
  snapshotDate?: string;
}

const CLAUDE_FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'] as const;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
const EXCLUDED_VARIANTS = ['mini', 'nano', 'lite', 'spark', 'preview', 'exp', 'experimental'];
const TIERS = ['pro', 'flash', 'sol', 'terra', 'luna', 'codex', 'thinking', 'fast', 'chat'];

function tokenize(id: string): string[] {
  return id
    .split(/[-_.\s/]+/)
    .flatMap((token) => token.split(/(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/))
    .filter(Boolean);
}

/** Split a vendor model id into the parts the ranking compares. Lower-cases everything. */
export function parseModelId(rawId: string): ParsedModelId {
  let id = rawId.trim().toLowerCase();
  const suffix = id.match(/\[([^\]]+)\]$/);
  const contextSuffix = suffix?.[1];
  if (suffix) id = id.slice(0, -suffix[0].length);
  const tokens = tokenize(id);
  const alpha = tokens.filter((token) => /^[a-z]+$/.test(token));
  const version: number[] = [];
  let snapshotDate: string | undefined;
  let sawFamilyNumbers = false;
  for (const token of tokens) {
    if (/^\d{8}$/.test(token)) {
      snapshotDate = token;
      continue;
    }
    if (/^\d+$/.test(token)) {
      if (!sawFamilyNumbers || version.length > 0) version.push(Number(token));
      continue;
    }
    if (version.length > 0) sawFamilyNumbers = true;
  }

  let vendor: ModelVendor | undefined;
  let family: string;
  const first = tokens[0] ?? '';
  const claudeFamily = alpha.find((token) =>
    (CLAUDE_FAMILIES as readonly string[]).includes(token)
  );
  if (first === 'claude' || claudeFamily) {
    vendor = 'claude';
    family = claudeFamily ?? 'claude';
  } else if (first === 'gemini') {
    vendor = 'gemini';
    family = 'gemini';
  } else if (first === 'grok') {
    vendor = 'grok';
    family = tokens[1] === 'code' ? 'grok-code' : 'grok';
  } else if (first === 'gpt' || first === 'o' || first === 'codex') {
    vendor = 'codex';
    family = first === 'o' ? 'o' : first === 'codex' ? 'codex' : 'gpt';
  } else {
    family = first;
  }

  const effort = [...alpha]
    .reverse()
    .find((token) => (EFFORTS as readonly string[]).includes(token));
  const excludedVariant =
    alpha.find((token) => EXCLUDED_VARIANTS.includes(token)) ??
    (snapshotDate ? 'snapshot' : undefined);
  const tier = alpha.find((token) => TIERS.includes(token) && token !== family);
  return { vendor, family, version, tier, effort, contextSuffix, excludedVariant, snapshotDate };
}

const CLAUDE_FAMILY_RANK: Record<string, number> = { fable: 4, opus: 3, sonnet: 2, haiku: 1 };
const CODEX_FAMILY_RANK: Record<string, number> = { gpt: 2, o: 1 };
const GROK_FAMILY_RANK: Record<string, number> = { grok: 2, 'grok-code': 1 };
const GEMINI_TIER_RANK: Record<string, number> = { pro: 2, flash: 1 };
const EFFORT_RANK: Record<string, number> = {
  ultra: 6,
  max: 5,
  xhigh: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function compareVersions(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

interface RankedModel {
  model: DiscoveredModel;
  parsed: ParsedModelId;
}

/** Positive when `left` should rank ahead of `right`. */
function compareModels(
  vendor: ModelVendor,
  left: RankedModel,
  right: RankedModel,
  preferGeminiTier: GeminiTier | undefined
): number {
  const a = left.parsed;
  const b = right.parsed;
  const familyRank =
    vendor === 'claude'
      ? CLAUDE_FAMILY_RANK
      : vendor === 'codex'
        ? CODEX_FAMILY_RANK
        : vendor === 'grok'
          ? GROK_FAMILY_RANK
          : undefined;
  const checks: Array<() => number> = [];
  if (vendor === 'gemini') {
    const tierDelta = () =>
      (GEMINI_TIER_RANK[a.tier ?? ''] ?? 0) - (GEMINI_TIER_RANK[b.tier ?? ''] ?? 0);
    const versionDelta = () => compareVersions(a.version, b.version);
    if (preferGeminiTier === 'pro') checks.push(tierDelta, versionDelta);
    else checks.push(versionDelta, tierDelta);
  } else {
    checks.push(() => (familyRank?.[a.family] ?? 0) - (familyRank?.[b.family] ?? 0));
    checks.push(() => compareVersions(a.version, b.version));
  }
  checks.push(() => Number(a.contextSuffix === '1m') - Number(b.contextSuffix === '1m'));
  checks.push(() => (EFFORT_RANK[a.effort ?? ''] ?? 0) - (EFFORT_RANK[b.effort ?? ''] ?? 0));
  checks.push(
    () =>
      (right.model.priority ?? Number.MAX_SAFE_INTEGER) -
      (left.model.priority ?? Number.MAX_SAFE_INTEGER)
  );
  checks.push(() => right.model.id.localeCompare(left.model.id));
  for (const check of checks) {
    const delta = check();
    if (delta !== 0) return delta;
  }
  return 0;
}

export interface PickOptions {
  preferGeminiTier?: GeminiTier;
}

/**
 * The best id in a vendor listing: hidden, superseded, and foreign-vendor ids are dropped, then
 * excluded variants (mini/nano/lite/spark/preview/exp/snapshots) unless nothing else remains.
 */
export function pickLatestModel(
  vendor: ModelVendor,
  models: readonly DiscoveredModel[],
  options: PickOptions = {}
): DiscoveredModel | undefined {
  const usable = models
    .map((model): RankedModel => ({ model, parsed: parseModelId(model.id) }))
    .filter(
      ({ model, parsed }) =>
        !model.hidden &&
        !model.supersededBy &&
        (parsed.vendor === undefined || parsed.vendor === vendor)
    );
  const preferred = usable.filter(({ parsed }) => !parsed.excludedVariant);
  const pool = preferred.length > 0 ? preferred : usable;
  const sorted = [...pool].sort((left, right) =>
    compareModels(vendor, right, left, options.preferGeminiTier)
  );
  return sorted[0]?.model;
}

/** Ids seen on a development machine or already in the repository, best first. */
export const CURATED_LATEST: Readonly<Record<ModelVendor, readonly string[]>> = {
  claude: ['claude-fable-5-1[1m]', 'claude-fable-5[1m]'],
  codex: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-5.6-sol'],
  gemini: ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.1-pro-high'],
  grok: ['grok-4.7', 'grok-4.6'],
};

export interface ResolvedModel {
  vendor: ModelVendor;
  id: string;
  origin: ModelOrigin;
  contextWindowTokens?: number;
  /** Models the vendor listed, before ranking filters. */
  discoveredCount: number;
  source?: ModelSource;
  pinned?: string;
  /** The discovered pick, kept even when an explicit id or a pin won. */
  latestDiscovered?: string;
  /** Why a fallback was used, or the discovery error. */
  note?: string;
}

export interface ModelChoiceInput {
  vendor: ModelVendor;
  policy: ModelPolicy;
  pinned?: string;
  pinnedContextTokens?: number;
  /** `--model KEY=ID` or a `*_DEFAULT_MODEL` variable present before the preset ran. */
  explicit?: string;
  discovered?: readonly DiscoveredModel[];
  source?: ModelSource;
  discoveryError?: string;
  preferGeminiTier?: GeminiTier;
}

/** Precedence: explicit > (policy pinned) > discovered latest > preset pin > curated table. */
export function resolveModelChoice(input: ModelChoiceInput): ResolvedModel {
  const discovered = input.discovered ?? [];
  const latest = pickLatestModel(input.vendor, discovered, {
    preferGeminiTier: input.preferGeminiTier,
  });
  const base = {
    vendor: input.vendor,
    discoveredCount: discovered.length,
    source: input.source,
    pinned: input.pinned,
    latestDiscovered: latest?.id,
  };
  const windowFor = (id: string): number | undefined =>
    discovered.find((model) => model.id === id)?.contextWindowTokens ??
    (id === input.pinned ? input.pinnedContextTokens : undefined);
  if (input.explicit) {
    return {
      ...base,
      id: input.explicit,
      origin: 'explicit',
      contextWindowTokens: windowFor(input.explicit),
    };
  }
  if (input.policy === 'pinned') {
    const id = input.pinned ?? CURATED_LATEST[input.vendor][0];
    return {
      ...base,
      id,
      origin: input.pinned ? 'pinned' : 'fallback',
      contextWindowTokens: windowFor(id),
      note: input.pinned ? undefined : 'preset has no pin; curated table used',
    };
  }
  if (latest) {
    return { ...base, id: latest.id, origin: 'latest', contextWindowTokens: windowFor(latest.id) };
  }
  const id = input.pinned ?? CURATED_LATEST[input.vendor][0];
  return {
    ...base,
    id,
    origin: 'fallback',
    contextWindowTokens: windowFor(id),
    note: input.discoveryError ?? 'discovery returned no usable model',
  };
}

/** Short origin text for tables: `auto: latest of 7`, `pinned`, `explicit`, `fallback: ...`. */
export function describeModelOrigin(model: ResolvedModel): string {
  switch (model.origin) {
    case 'explicit':
      return 'explicit';
    case 'pinned':
      return 'pinned';
    case 'latest':
      return `auto: latest of ${model.discoveredCount}`;
    case 'fallback':
      return `fallback: ${model.note ?? 'discovery failed'}`;
  }
}
