import {
  candidateText,
  candidatesText,
  errorHints,
  formatDuration,
  normalizeCandidateId,
  runPreviewLines,
  runSummaryText,
  statusText,
} from '../../src/cli/format.js';
import { DEFAULT_DIAL_POLICY, resolveDialPolicy } from '../../src/research/dials.js';
import type {
  DialConfig,
  HypothesisCandidate,
  HypothesisReview,
  ResearchRunPreview,
  ResearchSession,
} from '../../src/research/types.js';

const DEFAULT_DIAL_CONFIG: DialConfig = {
  novelty: 5,
  skepticism: 5,
  origins: { novelty: 'default', skepticism: 'default' },
};

function candidate(id: string, rank: number, score: number): HypothesisCandidate {
  return {
    id,
    sessionId: 'RC-1',
    generationIndex: 0,
    authorProvider: 'duck-a',
    status: 'distinct',
    rank,
    score,
    createdAt: '2026-08-27T00:00:00.000Z',
    title: `Title ${id}`,
    claim: 'claim',
    mechanism: 'mechanism',
    predictions: ['prediction'],
    assumptions: [],
    falsifier: 'falsifier',
    minimalExperiment: 'experiment',
    confidence: 0.5,
  };
}

function review(hypothesisId: string, verdict: HypothesisReview['verdict']): HypothesisReview {
  return {
    id: `RV-${hypothesisId}`,
    sessionId: 'RC-1',
    hypothesisId,
    reviewerProvider: 'duck-b',
    selfReview: false,
    createdAt: '2026-08-27T00:00:00.000Z',
    plausibility: 7,
    novelty: 7,
    testability: 7,
    falsifiability: 7,
    feasibility: 7,
    robustness: 7,
    fatalFlaw: null,
    strongestObjection: 'objection',
    hiddenAssumptions: [],
    proposedDiscriminatingTest: 'test',
    verdict,
    confidence: 0.7,
  };
}

function session(): ResearchSession {
  return {
    version: 1,
    id: 'RC-1',
    goal: 'Explain the drift',
    status: 'completed',
    stage: 'completed',
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:06:00.000Z',
    config: {
      providers: ['duck-a', 'duck-b'],
      hypothesesPerProvider: 2,
      topK: 1,
      minProviders: 2,
      seed: 42,
      maxContextBytes: 4096,
      contextPaths: ['.'],
      contextRoot: '/repo',
      markdownOnly: false,
      contextBudget: { maxBytes: 4096, limitingProvider: 'duck-a', providerLimits: [] },
    },
    providers: ['duck-a', 'duck-b'],
    unavailableProviders: [],
    contextManifest: {
      files: [],
      deniedPaths: [],
      omittedPaths: [],
      totalBytes: 0,
      includedBytes: 1024,
      packetBytes: 1024,
      maxBytes: 4096,
      packetSha256: 'abc',
    },
    candidates: [candidate('H-002', 1, 7.5), candidate('H-001', 2, 6.25)],
    reviews: [review('H-002', 'accept'), review('H-001', 'weak_accept')],
    falsifications: [],
    calls: [],
    warnings: ['duck-b returned 1/2 requested hypotheses'],
    reportMarkdownPath: '/sessions/RC-1/report.md',
  };
}

describe('CLI formatting', () => {
  it('normalizes candidate id shorthands', () => {
    expect(normalizeCandidateId('H-001')).toBe('H-001');
    expect(normalizeCandidateId('h-1')).toBe('H-001');
    expect(normalizeCandidateId('H12')).toBe('H-012');
    expect(normalizeCandidateId(' 3 ')).toBe('H-003');
    expect(normalizeCandidateId('RC-1')).toBe('RC-1');
  });

  it('formats durations for humans', () => {
    expect(formatDuration(4_500)).toBe('4s');
    expect(formatDuration(372_000)).toBe('6m 12s');
    expect(formatDuration(3_720_000)).toBe('1h 02m');
  });

  it('summarizes a finished run with ranked candidates, verdicts, and next steps', () => {
    const text = runSummaryText(session(), { elapsedMs: 372_000, copiedReportPath: '/out.md' });

    expect(text).toContain('RC-1  COMPLETE · 6m 12s');
    expect(text).toContain('1. H-002  Title H-002  [review 7.50 · accept]');
    expect(text).toContain('2. H-001  Title H-001  [review 6.25 · weak_accept]');
    expect(text).toContain('Warnings: 1');
    expect(text).toContain('Report: /sessions/RC-1/report.md');
    expect(text).toContain('Report copied to: /out.md');
    expect(text).toContain('Next: hc show H-002');
    expect(text).not.toContain('duck-');
  });

  it('lists warnings and verdicts in status and candidate views', () => {
    expect(statusText(session())).toContain('  - duck-b returned 1/2 requested hypotheses');
    expect(statusText(session())).not.toContain('Dials:');
    expect(candidatesText(session())).toContain('[review 7.50 · accept · novelty 7]');
  });

  it('shows recorded dials, penalties, and out-of-the-box batches', () => {
    const current = session();
    current.config.dials = {
      novelty: 8,
      skepticism: 5,
      origins: { novelty: 'file', skepticism: 'default' },
    };
    current.candidates[1].variant = 'out-of-box';
    current.candidates[1].scorePenalties = { unsupportedEvidence: 1 };

    expect(statusText(current)).toContain('Dials: novelty 8/10 (high) · skepticism 5/10 (medium)');
    const list = candidatesText(current);
    expect(list).toContain('unsupported evidence · out-of-the-box');
    expect(candidateText(current, 'H-001')).toContain('Status: distinct · out-of-the-box batch');
  });

  it('marks untestable falsifiers, consensus crowding, and evidence provenance', () => {
    const current = session();
    current.consensusCrowding = {
      similarityThreshold: 0.45,
      clusters: [{ candidateIds: ['H-001', 'H-002'], providerCount: 2 }],
      crowdedCandidateIds: ['H-001', 'H-002'],
      crowdingRatio: 1,
    };
    current.reviews[0].killCriterion = 'untestable';
    current.candidates[0].differsFromConsensus = 'Predicts an inverse correlation under load';
    current.candidates[0].evidence = [
      {
        claim: 'grounded',
        basis: 'context',
        contextQuote: 'quoted words',
        verification: 'verified',
      },
      { claim: 'literature memory', basis: 'general-knowledge', verification: 'not-applicable' },
    ];

    const list = candidatesText(current);
    expect(list).toContain('untestable falsifier');
    expect(list).toContain('crowded');

    const detail = candidateText(current, 'H-002');
    expect(detail).toContain('Differs from consensus: Predicts an inverse correlation under load');
    expect(detail).toContain('Evidence: 1 verified context · 1 general knowledge');
    expect(detail).toContain('(graded untestable)');
  });

  it('renders the run preview with the planned call budget', () => {
    const preview: ResearchRunPreview = {
      goal: 'Explain the drift',
      providers: ['duck-a', 'duck-b'],
      minProviders: 2,
      hypothesesPerProvider: 3,
      topK: 3,
      plannedCalls: {
        generation: 2,
        outOfBox: 0,
        review: 6,
        falsification: 3,
        falsificationRounds: 1,
        total: 11,
      },
      dials: DEFAULT_DIAL_CONFIG,
      policy: DEFAULT_DIAL_POLICY,
      contextManifest: session().contextManifest,
      contextBudget: {
        maxBytes: 4096,
        limitingProvider: 'duck-a',
        providerLimits: [
          {
            provider: 'duck-a',
            model: 'model-a',
            contextWindowTokens: 200_000,
            reservedOutputTokens: 32_000,
            maxContextBytes: 4096,
            source: 'model',
            transportLimited: true,
          },
        ],
      },
      contextRoot: '/repo',
      markdownOnly: true,
    };

    const lines = runPreviewLines(preview);

    expect(lines).toContain('Providers: duck-a, duck-b (at least 2 must be ready)');
    expect(lines).toContain('Dials: novelty 5/10 (default) · skepticism 5/10 (default)');
    expect(lines).toContain(
      'Planned provider calls: 11 (2 generation × 3 hypotheses, up to 6 reviews, 3 falsifications), plus repairs and retries when needed'
    );
    expect(lines.find((line) => line.startsWith('Shared context budget'))).toContain(
      'argument transport'
    );

    const ambitious: ResearchRunPreview = {
      ...preview,
      plannedCalls: {
        generation: 2,
        outOfBox: 2,
        review: 10,
        falsification: 6,
        falsificationRounds: 2,
        total: 20,
      },
      dials: { novelty: 9, skepticism: 8, origins: { novelty: 'flag', skepticism: 'env' } },
      policy: resolveDialPolicy({ novelty: 9, skepticism: 8 }, 3),
    };
    const ambitiousLines = runPreviewLines(ambitious);
    expect(ambitiousLines).toContain('Dials: novelty 9/10 (flag) · skepticism 8/10 (env)');
    expect(ambitiousLines).toContain(
      'Planned provider calls: 20 (2 generation × 3 hypotheses, 2 out-of-the-box × 2, up to 10 reviews, 6 falsifications over 2 rounds), plus repairs and retries when needed'
    );
  });

  it('warns loudly when a requested context path matched no eligible files', () => {
    const preview: ResearchRunPreview = {
      goal: 'Explain the drift',
      providers: ['duck-a'],
      minProviders: 1,
      hypothesesPerProvider: 3,
      topK: 3,
      plannedCalls: {
        generation: 1,
        outOfBox: 0,
        review: 3,
        falsification: 3,
        falsificationRounds: 1,
        total: 7,
      },
      dials: DEFAULT_DIAL_CONFIG,
      policy: DEFAULT_DIAL_POLICY,
      contextManifest: {
        ...session().contextManifest,
        unmatchedRequestedPaths: ['notes/*.txt', 'missing.md'],
      },
      contextBudget: { maxBytes: 4096, limitingProvider: 'duck-a', providerLimits: [] },
      contextRoot: '/repo',
      markdownOnly: false,
    };

    const lines = runPreviewLines(preview);

    expect(lines).toContain(
      'Warning: context path "notes/*.txt" matched no eligible files (missing, denied, or unsupported type).'
    );
    expect(lines).toContain(
      'Warning: context path "missing.md" matched no eligible files (missing, denied, or unsupported type).'
    );
  });

  it('offers actionable hints for common failures', () => {
    expect(errorHints('No Rubber Duck providers are configured')[0]).toContain('hc doctor');
    expect(errorHints('Preflight found 1 usable providers; 2 required')[0]).toContain('--probe');
    expect(errorHints('No current research session')[0]).toContain('hc run');
    expect(errorHints('Unknown preset: nope')[0]).toContain('hc presets');
    expect(errorHints('Unknown setting: nope')[0]).toContain('hc settings help');
    expect(errorHints('something else')).toEqual([]);
  });
});
