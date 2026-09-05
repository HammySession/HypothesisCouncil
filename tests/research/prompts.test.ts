import { resolveDialPolicy } from '../../src/research/dials.js';
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
  differsFromConsensus: 'Predicts an inverse correlation where consensus predicts none',
  evidence: [
    {
      claim: 'A grounded claim',
      basis: 'context',
      contextQuote: 'quoted packet text',
      verification: 'verified',
    },
    { claim: 'A remembered claim', basis: 'general-knowledge', verification: 'not-applicable' },
  ],
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
  killCriterion: 'concrete',
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

  it('carry the falsifiability and provenance contract', () => {
    const generationPrompt = buildGenerationPrompt('A goal', 'PACKET', 3);
    expect(generationPrompt).toContain('"differsFromConsensus":"..."');
    expect(generationPrompt).toContain('"basis":"context"');
    expect(generationPrompt).toContain('restated consensus is recall, not a hypothesis');

    const reviewPrompt = buildReviewPrompt('A goal', candidate);
    expect(reviewPrompt).toContain('"killCriterion":"concrete"');
    expect(reviewPrompt).toContain('do not accept remembered literature on authority');
    expect(reviewPrompt).toContain('"verification": "verified"');
    expect(reviewPrompt).toContain('Predicts an inverse correlation');
  });

  it('state the dials and add guidance blocks only at the extremes', () => {
    const balanced = buildGenerationPrompt('A goal', 'PACKET', 3);
    expect(balanced).toContain('DIALS: novelty 5/10 (medium), skepticism 5/10 (medium).');
    expect(balanced).not.toContain('NOVELTY GUIDANCE');
    expect(balanced).not.toContain('OUT-OF-THE-BOX BATCH');

    const bold = buildGenerationPrompt('A goal', 'PACKET', 3, resolveDialPolicy({ novelty: 10 }));
    expect(bold).toContain('DIALS: novelty 10/10 (high)');
    expect(bold).toContain('NOVELTY GUIDANCE (high)');
    expect(bold).toContain('contradict the dominant explanation outright');
    expect(bold).not.toContain('OUT-OF-THE-BOX BATCH');
    expect(
      buildGenerationPrompt('A goal', 'PACKET', 3, resolveDialPolicy({ novelty: 0 }))
    ).toContain('NOVELTY GUIDANCE (low)');

    const outOfBox = buildGenerationPrompt(
      'A goal',
      'PACKET',
      2,
      resolveDialPolicy({ novelty: 10 }),
      'out-of-box'
    );
    expect(
      outOfBox.startsWith(`${PROMPT_VERSIONS.generationOutOfBox}\n${NON_INTERACTIVE_NOTICE}\n`)
    ).toBe(true);
    expect(outOfBox).toContain('OUT-OF-THE-BOX BATCH');

    expect(buildReviewPrompt('A goal', candidate)).not.toContain('SKEPTICISM GUIDANCE');
    const harsh = buildReviewPrompt('A goal', candidate, resolveDialPolicy({ skepticism: 10 }));
    expect(harsh).toContain('SKEPTICISM GUIDANCE (high)');
    expect(harsh).toContain('independent replication');
    expect(buildReviewPrompt('A goal', candidate, resolveDialPolicy({ skepticism: 0 }))).toContain(
      'SKEPTICISM GUIDANCE (low)'
    );

    const secondRound = buildFalsificationPrompt(
      'A goal',
      candidate,
      resolveDialPolicy({ skepticism: 10 }),
      2
    );
    expect(secondRound).toContain('SKEPTICISM GUIDANCE (high)');
    expect(secondRound).toContain('independent attack number 2');
    expect(buildFalsificationPrompt('A goal', candidate)).not.toContain('attack number');
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

  it('attaches user-provided context between the chat history and the question', () => {
    const prompt = buildSessionAskPrompt(
      session,
      'Does this match?',
      ['User: hi'],
      '# notes\nfile text'
    );
    expect(prompt).toContain(
      'PRIOR_CHAT\nUser: hi\n\nUSER-PROVIDED CONTEXT (files the user attached to this question)\n# notes\nfile text\n\nUSER QUESTION\nDoes this match?'
    );
    expect(buildSessionAskPrompt(session, 'q')).not.toContain('USER-PROVIDED CONTEXT');
  });
});
