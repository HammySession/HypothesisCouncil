import type { ContextBudgetPlan, ProviderContextLimit, ProviderDescriptor } from './types.js';

const BYTES_PER_TOKEN = 3;
const PROMPT_OVERHEAD_TOKENS = 8_192;
const ARGUMENT_TRANSPORT_LIMIT_BYTES = 96 * 1024;
// Windows CreateProcess caps the whole command line at 32,767 UTF-16 code units. The packet must
// leave room for the generation prompt framing, the CLI's own arguments, and quote escaping.
const WINDOWS_ARGUMENT_TRANSPORT_LIMIT_BYTES = 24 * 1024;

export function argumentTransportLimitBytes(platform: NodeJS.Platform = process.platform): number {
  return platform === 'win32'
    ? WINDOWS_ARGUMENT_TRANSPORT_LIMIT_BYTES
    : ARGUMENT_TRANSPORT_LIMIT_BYTES;
}

interface ModelLimit {
  contextWindowTokens: number;
  reservedOutputTokens: number;
}

interface ModelLimitMatch {
  limit: ModelLimit;
  /** False when the id matched no rule and the conservative default applies. */
  matched: boolean;
}

function known(contextWindowTokens: number, reservedOutputTokens: number): ModelLimitMatch {
  return { limit: { contextWindowTokens, reservedOutputTokens }, matched: true };
}

/**
 * Static context windows by model id. A `[1m]` suffix means a one-million-token profile on any
 * vendor; bare Claude aliases (`fable`, `opus`, `sonnet`, `haiku`) count as Claude models. GPT-6
 * uses the window the Codex catalog reports, since Codex is the council's only route to it.
 */
function modelLimit(model: string, provider: string): ModelLimitMatch {
  const identity = `${provider} ${model}`.toLowerCase();
  const oneMillion = /\[1m\]/.test(model.toLowerCase());
  if (/gpt-6/.test(identity)) return known(272_000, 32_000);
  if (/gpt-5\.[4-9]/.test(identity)) return known(1_050_000, 128_000);
  if (/gpt-5|codex/.test(identity)) return known(400_000, 128_000);
  if (/gpt-4\.1/.test(identity)) return known(1_047_576, 32_768);
  if (/gpt-4o/.test(identity)) return known(128_000, 16_384);
  if (/claude|\b(?:fable|opus|sonnet|haiku)\b/.test(identity)) {
    return known(oneMillion ? 1_000_000 : 200_000, 32_000);
  }
  if (/gemini/.test(identity)) return known(1_000_000, 65_536);
  if (/grok/.test(identity)) return known(256_000, 32_000);
  if (oneMillion) return known(1_000_000, 64_000);
  return { limit: { contextWindowTokens: 128_000, reservedOutputTokens: 32_000 }, matched: false };
}

function overrideName(provider: string): string {
  return `HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_${provider.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
}

function configuredLimit(
  provider: ProviderDescriptor,
  environment: NodeJS.ProcessEnv
): { limit: ModelLimit; source: ProviderContextLimit['source'] } {
  const override = environment[overrideName(provider.name)];
  if (override !== undefined) {
    const tokens = Number(override);
    if (!Number.isInteger(tokens) || tokens <= PROMPT_OVERHEAD_TOKENS) {
      throw new Error(
        `${overrideName(provider.name)} must be an integer greater than ${PROMPT_OVERHEAD_TOKENS}`
      );
    }
    const reservedOutputTokens = Math.min(128_000, Math.max(16_384, Math.floor(tokens * 0.1)));
    return {
      limit: { contextWindowTokens: tokens, reservedOutputTokens },
      source: 'configured-override',
    };
  }
  const knownModel = provider.model !== 'cli' && provider.model !== 'provider-default';
  const match = modelLimit(provider.model, provider.name);
  return {
    limit: match.limit,
    source: knownModel && match.matched ? 'model' : 'provider-default',
  };
}

/**
 * Whether a CLI provider receives the prompt as a command-line argument, which is subject to the
 * operating system's argument-length cap, instead of through stdin.
 */
export function usesArgumentTransport(
  provider: ProviderDescriptor,
  environment: NodeJS.ProcessEnv
): boolean {
  if (provider.type !== 'cli') return false;
  const key = provider.name
    .replace(/^cli-/, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .toUpperCase();
  if (environment[`CLI_CUSTOM_${key}_PROMPT_DELIVERY`] === 'stdin') return false;
  const wrapperStdinCompatibility =
    environment.HYPOTHESIS_COUNCIL_DISABLE_STDIN_COMPATIBILITY !== 'true' &&
    (key === 'CLAUDE' || key === 'CODEX') &&
    environment[`CLI_${key}_ENABLED`] === 'true' &&
    !environment[`CLI_${key}_CLI_ARGS`] &&
    !environment[`CLI_${key}_SYSTEM_PROMPT`];
  return !wrapperStdinCompatibility;
}

export function calculateContextBudget(
  providers: ProviderDescriptor[],
  selectedProviders: string[],
  requestedMaxBytes?: number,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): ContextBudgetPlan {
  const transportLimitBytes = argumentTransportLimitBytes(platform);
  if (
    requestedMaxBytes !== undefined &&
    (!Number.isInteger(requestedMaxBytes) || requestedMaxBytes <= 0)
  ) {
    throw new Error('maxContextBytes must be a positive integer');
  }
  const byName = new Map(providers.map((provider) => [provider.name, provider]));
  const limits = selectedProviders.map((name): ProviderContextLimit => {
    const provider = byName.get(name) || {
      name,
      nickname: name,
      model: 'provider-default',
      type: 'unknown' as const,
    };
    const configured = configuredLimit(provider, environment);
    const usableTokens = Math.max(
      1,
      configured.limit.contextWindowTokens -
        configured.limit.reservedOutputTokens -
        PROMPT_OVERHEAD_TOKENS
    );
    const modelBytes = usableTokens * BYTES_PER_TOKEN;
    const transportLimited =
      usesArgumentTransport(provider, environment) && modelBytes > transportLimitBytes;
    return {
      provider: name,
      model: provider.model,
      contextWindowTokens: configured.limit.contextWindowTokens,
      reservedOutputTokens: configured.limit.reservedOutputTokens,
      maxContextBytes: transportLimited ? transportLimitBytes : modelBytes,
      source: configured.source,
      transportLimited,
    };
  });
  if (limits.length === 0) throw new Error('At least one provider is required for context sizing');
  limits.sort((left, right) => left.provider.localeCompare(right.provider));
  const limiting = [...limits].sort(
    (left, right) =>
      left.maxContextBytes - right.maxContextBytes || left.provider.localeCompare(right.provider)
  )[0];
  return {
    maxBytes: Math.min(limiting.maxContextBytes, requestedMaxBytes ?? Number.MAX_SAFE_INTEGER),
    limitingProvider: limiting.provider,
    ...(requestedMaxBytes === undefined ? {} : { requestedMaxBytes }),
    providerLimits: limits,
  };
}
