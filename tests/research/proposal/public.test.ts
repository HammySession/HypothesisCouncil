import {
  createPublicProposalReport,
  priorFindingsFrom,
  publicProposalSnapshot,
} from '../../../src/research/proposal/public.js';
import {
  renderDraftMarkdown,
  renderProposalMarkdown,
  renderTranscriptMarkdown,
} from '../../../src/research/proposal/report.js';
import type { ResearchSession } from '../../../src/research/types.js';
import { AT, critique, draft, draftOutput, proposalSession, question } from './fixtures.js';

const session = proposalSession({
  stage: 'proposed',
  status: 'proposed',
  questions: [
    question('Q-001', 'What is the latency target?', {
      status: 'answered',
      answer: '200ms',
      sources: ['duck-a', 'duck-b'],
      askedByCount: 2,
    }),
    question('Q-002', 'Which regions?', { status: 'skipped', sources: ['duck-b'] }),
  ],
  rounds: [
    {
      round: 1,
      askedProviders: ['duck-a', 'duck-b'],
      doneProviders: [],
      questionIds: ['Q-001', 'Q-002'],
      createdAt: AT,
    },
  ],
  drafts: [
    { ...draft('D-001', 'duck-a', 'Alpha'), rank: 2, score: 6.5, authorModel: 'model-a' },
    { ...draft('D-002', 'duck-b', 'Beta'), rank: 1, score: 8 },
  ],
  critiques: [critique('D-001', 'duck-b'), critique('D-002', 'duck-a', { fatalGap: null })],
  proposal: {
    ...draftOutput('Merged'),
    source: 'synthesized',
    synthesizerProvider: 'duck-b',
    synthesizerModel: 'model-b',
    rationale: 'Beta had the sharper kill criterion.',
    alternatives: ['Alpha design kept as a fallback'],
    createdAt: AT,
  },
  warnings: ['Single-provider mode: critiques cannot provide independent authorship separation.'],
});

const PRIVATE_KEYS = [
  'authorProvider',
  'authorModel',
  'reviewerProvider',
  'synthesizerProvider',
  'synthesizerModel',
  'sources',
];

describe('public proposal projections', () => {
  it('strip every author, reviewer, synthesizer, and question-source field', () => {
    for (const projection of [
      publicProposalSnapshot(session),
      createPublicProposalReport(session),
    ]) {
      const text = JSON.stringify(projection);
      for (const key of PRIVATE_KEYS) expect(text).not.toContain(`"${key}"`);
      expect(text).not.toContain('model-a');
    }
    const report = createPublicProposalReport(session) as { drafts: Array<{ id: string }> };
    expect(report.drafts.map((item) => item.id)).toEqual(['D-002', 'D-001']);
    const snapshot = publicProposalSnapshot(session) as {
      rounds: Array<Record<string, unknown>>;
    };
    expect(snapshot.rounds[0]).toEqual({
      round: 1,
      questionIds: ['Q-001', 'Q-002'],
      createdAt: AT,
      askedCount: 2,
      doneCount: 0,
    });
  });

  it('projects council findings without authors or reviewers', () => {
    const council = {
      candidates: [
        {
          id: 'H-002',
          rank: 1,
          status: 'distinct',
          authorProvider: 'duck-a',
          title: 'Cache misses',
          claim: 'claim',
          mechanism: 'mechanism',
          predictions: ['p'],
          falsifier: 'f',
          minimalExperiment: 'e',
        },
        { id: 'H-001', status: 'duplicate', authorProvider: 'duck-b', title: 'dup' },
      ],
      reviews: [{ hypothesisId: 'H-002', reviewerProvider: 'duck-b', verdict: 'accept' }],
    } as unknown as ResearchSession;
    const findings = priorFindingsFrom(council);
    expect(findings).toEqual([
      {
        id: 'H-002',
        rank: 1,
        title: 'Cache misses',
        claim: 'claim',
        mechanism: 'mechanism',
        predictions: ['p'],
        falsifier: 'f',
        minimalExperiment: 'e',
        reviewVerdict: 'accept',
      },
    ]);
  });
});

describe('proposal markdown', () => {
  it('renders the merged proposal, ranked drafts, and alternatives without provider names', () => {
    const markdown = renderProposalMarkdown(session);
    expect(markdown).toContain('# Research proposal: Merged design');
    expect(markdown).toContain('### Step 1: Merged step one');
    expect(markdown).toContain('**Kill criterion:** no change after 3 runs');
    expect(markdown).toContain('**1. D-002 — Beta design** · score 8.00 · accept');
    expect(markdown).toContain('## Alternatives kept');
    expect(markdown).toContain('Beta had the sharper kill criterion.');
    expect(markdown).not.toContain('duck-');
    expect(markdown).not.toContain('model-');
  });

  it('renders the transcript by round with skipped answers and no provider names', () => {
    const markdown = renderTranscriptMarkdown(session);
    expect(markdown).toContain('## Round 1');
    expect(markdown).toContain(
      '**Q-001** (medium · asked by 2 members): What is the latency target?'
    );
    expect(markdown).toContain('**A:** 200ms');
    expect(markdown).toContain('**A:** _(skipped)_');
    expect(markdown).not.toContain('duck-');
  });

  it('renders a single draft with its blind critique', () => {
    const markdown = renderDraftMarkdown(session, session.drafts[0]!);
    expect(markdown).toContain('# Draft D-001: Alpha design');
    expect(markdown).toContain('rank 2 · score 6.50');
    expect(markdown).toContain('- Verdict: accept (confidence 0.70)');
    expect(markdown).toContain('- Missing steps: baseline measurement');
    expect(markdown).not.toContain('duck-');
  });
});
