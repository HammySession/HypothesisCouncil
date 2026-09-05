import { DEFAULT_DIALS, DIAL_MAX, DIAL_MIN, type DialSettings } from './settings.js';

export type SourceVerificationMode = 'none' | 'fetch' | 'fetch-plus-retraction';

/**
 * Everything the workflow derives from the two dials. Level 5/5 reproduces the constants the
 * council used before dials existed, so default runs are unchanged.
 */
export interface DialPolicy {
  novelty: number;
  skepticism: number;
  /** Weight of the novelty review score in the aggregate; 1 at level 5. */
  noveltyWeight: number;
  /** Weight of the robustness review score in the aggregate; 1 at level 5. */
  robustnessWeight: number;
  /** Cross-provider similarity above which candidates count as consensus-crowded. */
  crowdingThreshold: number;
  /** Score subtracted from a crowded candidate; 0 up to level 5. */
  crowdingPenalty: number;
  /** Extra sealed "out-of-the-box" generation calls per provider. */
  outOfBoxCalls: number;
  /** Hypotheses requested by each out-of-the-box call. */
  outOfBoxHypotheses: number;
  /** Score subtracted when no verified context evidence carries the claim; 0 up to level 5. */
  unsupportedEvidencePenalty: number;
  /** Whether candidates without verified context evidence rank below those with it. */
  unverifiedFinalistGate: boolean;
  /** Independent adversarial rounds per finalist. */
  falsificationRounds: number;
  /** Sources each scout is asked for per round (sources stage). */
  sourcesPerScout: number;
  /** Scouting rounds (sources stage). */
  sourceRounds: number;
  sourceVerification: SourceVerificationMode;
  /** Whether a source-critique call grades cited sources. */
  sourceCritique: boolean;
  /** Whether the report lists weakly supported claims in their own section. */
  weakClaimsSection: boolean;
  /**
   * Whether a cited source graded below 4 for reliability, or whose replication is contested,
   * counts as no support at all when ranking (very high skepticism only).
   */
  discountWeakSources: boolean;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function assertLevel(value: number, name: string): void {
  if (!Number.isInteger(value) || value < DIAL_MIN || value > DIAL_MAX) {
    throw new Error(`${name} must be an integer from ${DIAL_MIN} to ${DIAL_MAX}`);
  }
}

export function resolveDialPolicy(
  dials: Partial<DialSettings> = {},
  hypothesesPerProvider = 3
): DialPolicy {
  const novelty = dials.novelty ?? DEFAULT_DIALS.novelty;
  const skepticism = dials.skepticism ?? DEFAULT_DIALS.skepticism;
  assertLevel(novelty, 'novelty');
  assertLevel(skepticism, 'skepticism');
  const n = novelty - 5;
  const s = skepticism - 5;
  const outOfBox = novelty >= 8;
  return {
    novelty,
    skepticism,
    noveltyWeight: round2(1 + 0.15 * n),
    robustnessWeight: round2(1 + 0.15 * s),
    crowdingThreshold: round2(0.45 - 0.02 * n),
    crowdingPenalty: round2(Math.max(0, n / 5) * 1.5),
    outOfBoxCalls: outOfBox ? 1 : 0,
    outOfBoxHypotheses: outOfBox
      ? Math.max(1, Math.ceil((Math.max(1, hypothesesPerProvider) * (novelty - 7)) / 3))
      : 0,
    unsupportedEvidencePenalty: round2(Math.max(0, s / 5)),
    unverifiedFinalistGate: skepticism >= 8,
    falsificationRounds: skepticism >= 8 ? 2 : 1,
    sourcesPerScout: Math.max(2, Math.round(5 + 0.6 * s)),
    sourceRounds: novelty >= 8 ? 2 : 1,
    sourceVerification:
      skepticism <= 2 ? 'none' : skepticism >= 8 ? 'fetch-plus-retraction' : 'fetch',
    sourceCritique: skepticism >= 5,
    weakClaimsSection: skepticism >= 6,
    discountWeakSources: skepticism >= 8,
  };
}

/** The policy of a default 5/5 run. */
export const DEFAULT_DIAL_POLICY: Readonly<DialPolicy> = resolveDialPolicy(DEFAULT_DIALS);
