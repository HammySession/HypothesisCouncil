import type { ContextBudgetPlan, ProviderContextLimit, ProviderDescriptor } from './types.js';

const BYTES_PER_TOKEN = 3;
const PROMPT_OVERHEAD_TOKENS = 8_192;
const ARGUMENT_TRANSPORT_LIMIT_BYTES = 96 * 1024;

interface ModelLimit {
  contextWindowTokens: number;
  reservedOutputTokens: number;
}

function modelLimit(model: string, provider: string): ModelLimit {
  const identity = `${provider} ${model}`.toLowerCase();
  if (/gpt-5\.(?:4|5|6)/.test(identity)) {
    return { contextWindowTokens: 1_050_000, reservedOutputTokens: 128_000 };
  }
  if (/gpt-5|codex/.test(identity)) {
    return { contextWindowTokens: 400_000, reservedOutputTokens: 128_000 };
  }
  if (/gpt-4\.1/.test(identity)) {
    return { contextWindowTokens: 1_047_576, reservedOutputTokens: 32_768 };
  }
  if (/gpt-4o/.test(identity)) {
    return { contextWindowTokens: 128_000, reservedOutputTokens: 16_384 };
  }
  if (/claude/.test(identity)) {
    return { contextWindowTokens: 200_000, reservedOutputTokens: 32_000 };
  }
  if (/gemini/.test(identity)) {
    return { contextWindowTokens: 1_000_000, reservedOutputTokens: 65_536 };
  }
  if (/grok/.test(identity)) {
    return { contextWindowTokens: 256_000, reservedOutputTokens: 32_000 };
  }
  return { contextWindowTokens: 128_000, reservedOutputTokens: 32_000 };
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
  return {
    limit: modelLimit(provider.model, provider.name),
    source: knownModel ? 'model' : 'provider-default',
  };
}

function usesArgumentTransport(
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
  environment: NodeJS.ProcessEnv = process.env
): ContextBudgetPlan {
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
      usesArgumentTransport(provider, environment) && modelBytes > ARGUMENT_TRANSPORT_LIMIT_BYTES;
    return {
      provider: name,
      model: provider.model,
      contextWindowTokens: configured.limit.contextWindowTokens,
      reservedOutputTokens: configured.limit.reservedOutputTokens,
      maxContextBytes: transportLimited ? ARGUMENT_TRANSPORT_LIMIT_BYTES : modelBytes,
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
