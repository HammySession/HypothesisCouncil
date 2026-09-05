import { DEFAULT_DIAL_POLICY, resolveDialPolicy } from '../../src/research/dials.js';

describe('resolveDialPolicy', () => {
  it('reproduces the pre-dial constants at level 5/5', () => {
    expect(DEFAULT_DIAL_POLICY).toEqual({
      novelty: 5,
      skepticism: 5,
      noveltyWeight: 1,
      robustnessWeight: 1,
      crowdingThreshold: 0.45,
      crowdingPenalty: 0,
      outOfBoxCalls: 0,
      outOfBoxHypotheses: 0,
      unsupportedEvidencePenalty: 0,
      unverifiedFinalistGate: false,
      falsificationRounds: 1,
      sourcesPerScout: 5,
      sourceRounds: 1,
      sourceVerification: 'fetch',
      sourceCritique: true,
      weakClaimsSection: false,
      discountWeakSources: false,
    });
    expect(resolveDialPolicy()).toEqual(DEFAULT_DIAL_POLICY);
  });

  it('moves every knob monotonically with its dial', () => {
    const byNovelty = Array.from({ length: 11 }, (_, novelty) => resolveDialPolicy({ novelty }));
    for (let index = 1; index < byNovelty.length; index++) {
      const previous = byNovelty[index - 1];
      const current = byNovelty[index];
      expect(current.noveltyWeight).toBeGreaterThan(previous.noveltyWeight);
      expect(current.crowdingThreshold).toBeLessThan(previous.crowdingThreshold);
      expect(current.crowdingPenalty).toBeGreaterThanOrEqual(previous.crowdingPenalty);
      expect(current.outOfBoxCalls).toBeGreaterThanOrEqual(previous.outOfBoxCalls);
      expect(current.sourceRounds).toBeGreaterThanOrEqual(previous.sourceRounds);
    }
    const bySkepticism = Array.from({ length: 11 }, (_, skepticism) =>
      resolveDialPolicy({ skepticism })
    );
    for (let index = 1; index < bySkepticism.length; index++) {
      const previous = bySkepticism[index - 1];
      const current = bySkepticism[index];
      expect(current.robustnessWeight).toBeGreaterThan(previous.robustnessWeight);
      expect(current.unsupportedEvidencePenalty).toBeGreaterThanOrEqual(
        previous.unsupportedEvidencePenalty
      );
      expect(current.falsificationRounds).toBeGreaterThanOrEqual(previous.falsificationRounds);
      expect(current.sourcesPerScout).toBeGreaterThanOrEqual(previous.sourcesPerScout);
      expect(Number(current.unverifiedFinalistGate)).toBeGreaterThanOrEqual(
        Number(previous.unverifiedFinalistGate)
      );
      expect(Number(current.discountWeakSources)).toBeGreaterThanOrEqual(
        Number(previous.discountWeakSources)
      );
    }
  });

  it('reaches the documented endpoints', () => {
    expect(resolveDialPolicy({ novelty: 10, skepticism: 10 }, 3)).toEqual({
      novelty: 10,
      skepticism: 10,
      noveltyWeight: 1.75,
      robustnessWeight: 1.75,
      crowdingThreshold: 0.35,
      crowdingPenalty: 1.5,
      outOfBoxCalls: 1,
      outOfBoxHypotheses: 3,
      unsupportedEvidencePenalty: 1,
      unverifiedFinalistGate: true,
      falsificationRounds: 2,
      sourcesPerScout: 8,
      sourceRounds: 2,
      sourceVerification: 'fetch-plus-retraction',
      sourceCritique: true,
      weakClaimsSection: true,
      discountWeakSources: true,
    });
    expect(resolveDialPolicy({ novelty: 0, skepticism: 0 })).toMatchObject({
      noveltyWeight: 0.25,
      robustnessWeight: 0.25,
      crowdingThreshold: 0.55,
      crowdingPenalty: 0,
      outOfBoxCalls: 0,
      unsupportedEvidencePenalty: 0,
      unverifiedFinalistGate: false,
      falsificationRounds: 1,
      sourcesPerScout: 2,
      sourceVerification: 'none',
      sourceCritique: false,
      weakClaimsSection: false,
      discountWeakSources: false,
    });
    expect(resolveDialPolicy({ novelty: 8 }, 3).outOfBoxHypotheses).toBe(1);
    expect(resolveDialPolicy({ novelty: 9 }, 3).outOfBoxHypotheses).toBe(2);
    expect(resolveDialPolicy({ novelty: 10 }, 1).outOfBoxHypotheses).toBe(1);
  });

  it('rejects levels outside 0-10', () => {
    expect(() => resolveDialPolicy({ novelty: 11 })).toThrow(
      'novelty must be an integer from 0 to 10'
    );
    expect(() => resolveDialPolicy({ skepticism: 2.5 })).toThrow('skepticism must be an integer');
  });
});
