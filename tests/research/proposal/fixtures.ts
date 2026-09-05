import { DEFAULT_DIAL_POLICY } from '../../../src/research/dials.js';
import type {
  InterviewQuestion,
  ProposalCritique,
  ProposalDraft,
  ProposalSession,
} from '../../../src/research/proposal/types.js';
import type {
  ProposalCritiqueOutput,
  ProposalDraftOutput,
} from '../../../src/research/proposal/schemas.js';

export const AT = '2026-09-04T00:00:00.000Z';

export function draftOutput(prefix: string): ProposalDraftOutput {
  return {
    title: `${prefix} design`,
    background: `${prefix} background`,
    hypotheses: [
      {
        statement: `${prefix} statement`,
        rationale: `${prefix} rationale`,
        falsifier: `${prefix} falsifier`,
      },
    ],
    experiments: [
      {
        step: 1,
        title: `${prefix} step one`,
        method: `${prefix} method`,
        metrics: ['p99 latency'],
        successCriteria: 'p99 under 200ms',
        killCriteria: 'no change after 3 runs',
        resources: ['staging cluster'],
        estimatedEffort: '2 days',
      },
    ],
    risks: [`${prefix} risk`],
    dataNeeds: ['request logs'],
    deliverables: ['a report'],
    openAssumptions: [],
  };
}

export function critiqueOutput(
  overrides: Partial<ProposalCritiqueOutput> = {}
): ProposalCritiqueOutput {
  return {
    feasibility: 7,
    rigor: 7,
    clarity: 8,
    completeness: 6,
    killCriteriaQuality: 'concrete',
    fatalGap: null,
    strongestObjection: 'The effect could be seasonal.',
    missingSteps: ['baseline measurement'],
    suggestedChanges: ['add a control'],
    verdict: 'accept',
    confidence: 0.7,
    ...overrides,
  };
}

export function draft(id: string, author: string, prefix = id): ProposalDraft {
  return { ...draftOutput(prefix), id, authorProvider: author, createdAt: AT };
}

export function critique(
  draftId: string,
  reviewer: string,
  overrides: Partial<ProposalCritiqueOutput> = {}
): ProposalCritique {
  return {
    ...critiqueOutput(overrides),
    id: `PC-${draftId}`,
    draftId,
    reviewerProvider: reviewer,
    selfReview: false,
    createdAt: AT,
  };
}

export function question(
  id: string,
  text: string,
  overrides: Partial<InterviewQuestion> = {}
): InterviewQuestion {
  return {
    id,
    round: 1,
    question: text,
    whyItMatters: 'It changes the design.',
    priority: 'medium',
    sources: ['duck-a'],
    askedByCount: 1,
    status: 'open',
    ...overrides,
  };
}

export function proposalSession(overrides: Partial<ProposalSession> = {}): ProposalSession {
  return {
    version: 1,
    kind: 'proposal',
    id: 'RP-20260904-000000Z-abc123',
    topic: 'Reduce p99 latency of the checkout service',
    status: 'waiting',
    stage: 'awaiting-answers',
    createdAt: AT,
    updatedAt: AT,
    config: {
      providers: ['duck-a', 'duck-b'],
      minProviders: 2,
      seed: 7,
      maxRounds: 2,
      maxQuestionsPerProvider: 5,
      maxQuestionsPerRound: 8,
      interviewVisibility: 'sealed',
      mergeStrategy: 'synthesize',
      interview: true,
      dials: {
        novelty: 5,
        skepticism: 5,
        origins: { novelty: 'default', skepticism: 'default' },
      },
      policy: DEFAULT_DIAL_POLICY,
      contextPaths: [],
      contextRoot: '.',
      markdownOnly: false,
      maxContextBytes: 4096,
      contextBudget: { maxBytes: 4096, limitingProvider: 'duck-a', providerLimits: [] },
    },
    providers: ['duck-a', 'duck-b'],
    unavailableProviders: [],
    contextManifest: {
      requestedPaths: [],
      files: [],
      totalBytes: 0,
      maxBytes: 4096,
      truncated: false,
    } as ProposalSession['contextManifest'],
    questions: [],
    rounds: [],
    drafts: [],
    critiques: [],
    handoffs: [],
    calls: [],
    warnings: [],
    ...overrides,
  };
}
