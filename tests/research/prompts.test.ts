import {
  NON_INTERACTIVE_NOTICE,
  PROMPT_VERSIONS,
  buildFalsificationPrompt,
  buildGenerationPrompt,
  buildReviewPrompt,
  buildReviewRepairPrompt,
  buildSessionAskPrompt,
} from '../../src/research/prompts.js';
import type {
  HypothesisCandidate,
  HypothesisFalsification,
  HypothesisReview,
  ResearchSession,
} from '../../src/research/types.js';

const candidate: HypothesisCandidate = {
  id: 'H-001',
  sessionId: 'RC-test',
  generationIndex: 0,
  authorProvider: 'cli-codex',
  authorModel: 'gpt-5.5',
  title: 'A title',
  claim: 'A claim',
  mechanism: 'A mechanism',
  predictions: ['A prediction'],
  assumptions: ['An assumption'],
  falsifier: 'A falsifier',
  minimalExperiment: 'An experiment',
  confidence: 0.5,
  status: 'distinct',
  rank: 1,
  createdAt: '2026-01-01T00:00:00Z',
};

const review: HypothesisReview = {
  id: 'RV-H-001',
  sessionId: 'RC-test',
  hypothesisId: 'H-001',
  reviewerProvider: 'cli-grok',
  selfReview: false,
  plausibility: 7,
  novelty: 7,
  testability: 7,
  falsifiability: 7,
  feasibility: 7,
  robustness: 7,
  fatalFlaw: null,
  strongestObjection: 'The strongest objection text',
  hiddenAssumptions: ['A hidden assumption'],
  proposedDiscriminatingTest: 'A discriminating test',
  verdict: 'accept',
  confidence: 0.6,
  createdAt: '2026-01-01T00:00:00Z',
};

const falsification: HypothesisFalsification = {
  id: 'FL-H-001',
  sessionId: 'RC-test',
  hypothesisId: 'H-001',
  reviewerProvider: 'cli-agy',
  damagingAssumption: 'A damaging assumption',
  competingExplanation: 'A competing explanation',
  falsifyingObservation: 'A falsifying observation',
  discriminatingExperiment: 'A discriminating experiment',
  remainsUsefulIfMechanismFalse: 'Still useful',
  createdAt: '2026-01-01T00:00:00Z',
};

const session = {
  id: 'RC-test',
  goal: 'A goal',
  status: 'completed',
  candidates: [candidate],
  reviews: [review],
  falsifications: [falsification],
} as unknown as ResearchSession;

describe('council prompts', () => {
  it('open with their version tag and tell agentic CLIs not to explore or use tools', () => {
    const prompts = [
      [PROMPT_VERSIONS.generation, buildGenerationPrompt('A goal', 'PACKET', 3)],
      [PROMPT_VERSIONS.review, buildReviewPrompt('A goal', candidate)],
      [PROMPT_VERSIONS.falsification, buildFalsificationPrompt('A goal', candidate)],
      [PROMPT_VERSIONS.reviewRepair, buildReviewRepairPrompt('not json')],
    ];
    for (const [version, prompt] of prompts) {
      expect(prompt.startsWith(`${version}\n${NON_INTERACTIVE_NOTICE}\n`)).toBe(true);
    }
    expect(NON_INTERACTIVE_NOTICE).toContain('no tools');
  });
});

describe('buildSessionAskPrompt', () => {
  it('grounds the question in review and falsification content without provider identities', () => {
    const prompt = buildSessionAskPrompt(session, 'Which experiment is best?');

    expect(prompt).toContain('The strongest objection text');
    expect(prompt).toContain('A competing explanation');
    expect(prompt).toContain('Which experiment is best?');
    expect(prompt).not.toContain('reviewerProvider');
    expect(prompt).not.toContain('authorProvider');
    expect(prompt).not.toContain('cli-grok');
    expect(prompt).not.toContain('cli-agy');
    expect(prompt).not.toContain('cli-codex');
    expect(prompt).not.toContain('gpt-5.5');
  });
});
