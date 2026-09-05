import {
  activeInterviewers,
  interviewDone,
  mergeQuestions,
  nextAction,
  openQuestions,
  questionOrder,
  rankDrafts,
  transcript,
  visibleQuestions,
} from '../../../src/research/proposal/interview.js';
import { critique, draft, proposalSession, question } from './fixtures.js';

describe('mergeQuestions', () => {
  it('assigns ids in sorted provider order and merges near-duplicates across providers', () => {
    const session = proposalSession();
    const ids = mergeQuestions(
      session,
      [
        {
          provider: 'duck-b',
          output: {
            questions: [
              {
                question: 'What is the target p99 latency for the checkout service?',
                whyItMatters: 'Sets the success criterion.',
                priority: 'high',
              },
              {
                question: 'Which regions carry the most traffic?',
                whyItMatters: 'Chooses where to measure.',
                priority: 'low',
              },
            ],
          },
        },
        {
          provider: 'duck-a',
          output: {
            questions: [
              {
                question: 'What is the target p99 latency for the checkout service today?',
                whyItMatters: 'Sets the bar.',
                priority: 'medium',
              },
            ],
          },
        },
      ],
      1
    );
    expect(ids).toEqual(['Q-001', 'Q-002']);
    expect(session.questions.map((item) => [item.id, item.askedByCount, item.sources])).toEqual([
      ['Q-001', 2, ['duck-a', 'duck-b']],
      ['Q-002', 1, ['duck-b']],
    ]);
    // The first provider's wording and priority win; the duplicate only adds a source.
    expect(session.questions[0]?.priority).toBe('medium');
  });

  it('auto-resolves a later question that repeats an answered one and caps the round', () => {
    const session = proposalSession({
      config: { ...proposalSession().config, maxQuestionsPerRound: 1 },
      questions: [
        question('Q-001', 'What is the target p99 latency for the checkout service?', {
          status: 'answered',
          answer: '200ms',
        }),
      ],
    });
    const ids = mergeQuestions(
      session,
      [
        {
          provider: 'duck-b',
          output: {
            questions: [
              {
                question: 'What p99 latency target does the checkout service need?',
                whyItMatters: 'x',
                priority: 'high',
              },
              {
                question: 'Is there a staging environment?',
                whyItMatters: 'y',
                priority: 'high',
              },
              {
                question: 'Who owns the service?',
                whyItMatters: 'z',
                priority: 'low',
              },
            ],
          },
        },
      ],
      2
    );
    // The repeat of the answered question merges into it; only one new question fits the round.
    expect(ids).toEqual(['Q-001', 'Q-002']);
    expect(session.questions[0]?.sources).toEqual(['duck-a', 'duck-b']);
    const added = session.questions.find((item) => item.id === 'Q-002');
    expect(added?.status).toBe('open');
    expect(added?.question).toBe('Is there a staging environment?');
    expect(session.questions).toHaveLength(2);
  });

  it('marks a new near-duplicate of an answered question as auto-resolved', () => {
    const session = proposalSession({
      questions: [
        question('Q-001', 'Is there a staging environment available?', {
          status: 'answered',
          answer: 'Yes',
        }),
      ],
    });
    // Below the merge threshold but above the auto-resolve threshold.
    mergeQuestions(
      session,
      [
        {
          provider: 'duck-b',
          output: {
            questions: [
              {
                question: 'Is there a staging environment available now?',
                whyItMatters: 'x',
                priority: 'high',
              },
            ],
          },
        },
      ],
      2,
      0.9
    );
    expect(session.questions[1]).toMatchObject({
      id: 'Q-002',
      status: 'auto-resolved',
      resolvedBy: 'Q-001',
    });
    expect(transcript(session)).toContain('A: (covered by Q-001: Yes)');
  });
});

describe('interview bookkeeping', () => {
  const session = proposalSession({
    questions: [
      question('Q-001', 'First?', { sources: ['duck-a'], priority: 'low' }),
      question('Q-002', 'Second?', { sources: ['duck-b'], priority: 'high' }),
      question('Q-003', 'Third?', {
        sources: ['duck-a', 'duck-b'],
        askedByCount: 2,
        priority: 'high',
        status: 'answered',
        answer: 'Yes.',
      }),
    ],
    rounds: [
      {
        round: 1,
        askedProviders: ['duck-a', 'duck-b'],
        doneProviders: ['duck-b'],
        questionIds: ['Q-001', 'Q-002', 'Q-003'],
        createdAt: '2026-09-04T00:00:00.000Z',
      },
    ],
  });

  it('shows sealed providers only their own questions and visible mode everything', () => {
    expect(visibleQuestions(session, 'duck-a').map((item) => item.id)).toEqual(['Q-001', 'Q-003']);
    expect(visibleQuestions(session, 'duck-b', 'visible').map((item) => item.id)).toEqual([
      'Q-001',
      'Q-002',
      'Q-003',
    ]);
  });

  it('orders open questions by priority, then how many asked, then id', () => {
    expect(questionOrder(openQuestions(session)).map((item) => item.id)).toEqual([
      'Q-002',
      'Q-001',
    ]);
    expect(questionOrder(session.questions).map((item) => item.id)).toEqual([
      'Q-003',
      'Q-002',
      'Q-001',
    ]);
  });

  it('renders the transcript without provider names', () => {
    const text = transcript(session);
    expect(text).toContain('Q-003 (round 1, high): Third?\nA: Yes.');
    expect(text).toContain('A: (not answered yet)');
    expect(text).not.toContain('duck-');
  });

  it('knows who still interviews, when the interview is done, and what comes next', () => {
    expect(activeInterviewers(session)).toEqual(['duck-a']);
    expect(interviewDone(session)).toBe(false);
    expect(nextAction(session)).toMatchObject({ kind: 'answer', openQuestions: 2, round: 1 });

    const answered = proposalSession({
      ...session,
      questions: session.questions.map((item) => ({ ...item, status: 'answered' as const })),
    });
    expect(interviewDone(answered)).toBe(false);
    expect(nextAction(answered)).toMatchObject({ kind: 'next-round', round: 1 });

    const exhausted = { ...answered, config: { ...answered.config, maxRounds: 1 } };
    expect(interviewDone(exhausted)).toBe(true);
    expect(nextAction(exhausted).kind).toBe('draft');
    expect(nextAction({ ...exhausted, stage: 'interview-complete' }).kind).toBe('draft');
    expect(nextAction({ ...exhausted, stage: 'proposed', status: 'proposed' }).kind).toBe('pick');
    expect(nextAction({ ...exhausted, status: 'failed' }).kind).toBe('resume');
    expect(interviewDone({ ...session, config: { ...session.config, interview: false } })).toBe(
      true
    );
  });
});

describe('rankDrafts', () => {
  it('sinks fatal gaps below untestable kill criteria below everything else, then scores', () => {
    const drafts = [draft('D-001', 'duck-a'), draft('D-002', 'duck-b'), draft('D-003', 'duck-c')];
    const critiques = [
      critique('D-001', 'duck-b', { feasibility: 9, rigor: 9, clarity: 9, completeness: 9 }),
      critique('D-002', 'duck-c', { killCriteriaQuality: 'untestable', feasibility: 10 }),
      critique('D-003', 'duck-a', { fatalGap: 'No control group', verdict: 'fatal' }),
    ];
    const ranked = rankDrafts(drafts, critiques);
    expect(ranked.map((item) => [item.id, item.rank, item.score])).toEqual([
      ['D-001', 1, 9],
      ['D-002', 2, 7.75],
      ['D-003', 3, 7],
    ]);
  });

  it('ranks an uncritiqued draft last among clean drafts by score and keeps ids stable', () => {
    const ranked = rankDrafts(
      [draft('D-002', 'duck-b'), draft('D-001', 'duck-a')],
      [critique('D-002', 'duck-a')]
    );
    expect(ranked.map((item) => item.id)).toEqual(['D-002', 'D-001']);
    expect(ranked[1]?.score).toBe(0);
  });
});
