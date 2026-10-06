import { calculateContextBudget } from '../../src/research/context-budget.js';
import type { ProviderDescriptor } from '../../src/research/types.js';

function provider(
  name: string,
  model: string,
  type: ProviderDescriptor['type'] = 'http'
): ProviderDescriptor {
  return { name, nickname: name, model, type };
}

describe('calculateContextBudget', () => {
  it('uses the smallest usable model context for a shared independent packet', () => {
    const plan = calculateContextBudget(
      [provider('openai', 'gpt-5.6-sol'), provider('anthropic', 'claude-sonnet')],
      ['openai', 'anthropic'],
      undefined,
      {}
    );

    expect(plan.limitingProvider).toBe('anthropic');
    expect(plan.maxBytes).toBe((200_000 - 32_000 - 8_192) * 3);
    expect(plan.providerLimits.find((limit) => limit.provider === 'openai')).toMatchObject({
      contextWindowTokens: 1_050_000,
      reservedOutputTokens: 128_000,
      source: 'model',
    });
  });

  it('honors a lower user cap and a per-provider token override', () => {
    const plan = calculateContextBudget(
      [provider('private-duck', 'provider-default')],
      ['private-duck'],
      123_456,
      { HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_PRIVATE_DUCK: '300000' }
    );

    expect(plan.maxBytes).toBe(123_456);
    expect(plan.requestedMaxBytes).toBe(123_456);
    expect(plan.providerLimits[0]).toMatchObject({
      contextWindowTokens: 300_000,
      source: 'configured-override',
    });
  });

  it('caps argument-based CLI providers but allows wrapper-compatible stdin presets', () => {
    const argumentPlan = calculateContextBudget(
      [provider('cli-gemini', 'gemini-pro', 'cli')],
      ['cli-gemini'],
      undefined,
      { CLI_GEMINI_ENABLED: 'true' },
      'linux'
    );
    const stdinPlan = calculateContextBudget(
      [provider('cli-codex', 'gpt-5.6-sol', 'cli')],
      ['cli-codex'],
      undefined,
      { CLI_CODEX_ENABLED: 'true' },
      'linux'
    );

    expect(argumentPlan.providerLimits[0].transportLimited).toBe(true);
    expect(argumentPlan.maxBytes).toBe(96 * 1024);
    expect(stdinPlan.providerLimits[0].transportLimited).toBe(false);
    expect(stdinPlan.maxBytes).toBeGreaterThan(2_000_000);
  });

  it('uses the smaller Windows command-line limit for argument-based CLI providers', () => {
    const windowsPlan = calculateContextBudget(
      [provider('cli-grok', 'grok-4.6', 'cli'), provider('cli-codex', 'gpt-5.5', 'cli')],
      ['cli-grok', 'cli-codex'],
      undefined,
      { CLI_CUSTOM_GROK_PROMPT_DELIVERY: 'flag', CLI_CODEX_ENABLED: 'true' },
      'win32'
    );

    expect(windowsPlan.limitingProvider).toBe('cli-grok');
    expect(windowsPlan.maxBytes).toBe(24 * 1024);
    expect(windowsPlan.providerLimits.find((limit) => limit.provider === 'cli-grok')).toMatchObject(
      { transportLimited: true, maxContextBytes: 24 * 1024 }
    );
    expect(
      windowsPlan.providerLimits.find((limit) => limit.provider === 'cli-codex')?.transportLimited
    ).toBe(false);
  });

  it('derives windows from model ids, including 1M profiles and bare Claude aliases', () => {
    const plan = calculateContextBudget(
      [
        provider('a', 'claude-fable-5-1[1m]'),
        provider('b', 'fable[1m]'),
        provider('c', 'opus'),
        provider('d', 'gpt-5.6-terra'),
        provider('e', 'quantum-9000'),
        provider('f', 'provider-default'),
        provider('cli-codex_scout', 'gpt-6.1-sol', 'cli'),
      ],
      ['a', 'b', 'c', 'd', 'e', 'f', 'cli-codex_scout'],
      undefined,
      {}
    );
    const byName = Object.fromEntries(plan.providerLimits.map((limit) => [limit.provider, limit]));
    expect(byName.a).toMatchObject({ contextWindowTokens: 1_000_000, source: 'model' });
    expect(byName.b).toMatchObject({ contextWindowTokens: 1_000_000, source: 'model' });
    expect(byName.c).toMatchObject({ contextWindowTokens: 200_000, source: 'model' });
    expect(byName.d).toMatchObject({ contextWindowTokens: 1_050_000, source: 'model' });
    // GPT-6 follows the Codex catalog window, even behind a provider name that says `codex`.
    expect(byName['cli-codex_scout']).toMatchObject({
      contextWindowTokens: 272_000,
      source: 'model',
    });
    // An id no rule recognises is a conservative default, not a claimed model window.
    expect(byName.e).toMatchObject({ contextWindowTokens: 128_000, source: 'provider-default' });
    expect(byName.f).toMatchObject({ contextWindowTokens: 128_000, source: 'provider-default' });
  });

  it('rejects malformed context-window overrides', () => {
    expect(() =>
      calculateContextBudget([provider('duck', 'provider-default')], ['duck'], undefined, {
        HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_DUCK: 'many',
      })
    ).toThrow('HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_DUCK');
  });
});
