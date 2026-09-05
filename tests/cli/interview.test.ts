import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { NON_INTERACTIVE_INTERVIEW_HINT, runInterviewLoop } from '../../src/cli/interview.js';
import { createMemoryIO, type MemoryIOOptions } from '../../src/cli/shell/io.js';
import { ResearchProposalService } from '../../src/research/proposal/service.js';
import { ProposalSessionStore } from '../../src/research/proposal/store.js';
import type { ProposalSession } from '../../src/research/proposal/types.js';
import type {
  ProviderDescriptor,
  ResearchCompletion,
  ResearchProviderGateway,
} from '../../src/research/types.js';

class InterviewGateway implements ResearchProviderGateway {
  listProviders(): Promise<ProviderDescriptor[]> {
    return Promise.resolve(
      ['duck-a', 'duck-b'].map((name) => ({
        name,
        nickname: name,
        model: `${name}-model`,
        type: 'cli' as const,
      }))
    );
  }

  healthCheck(): Promise<boolean> {
    return Promise.resolve(true);
  }

  complete(provider: string, prompt: string): Promise<ResearchCompletion> {
    const reply = (value: unknown) =>
      Promise.resolve({ content: JSON.stringify(value), model: `${provider}-model` });
    if (prompt.includes('ROUND 2 OF')) return reply({ questions: [], done: true });
    if (provider === 'duck-a') {
      return reply({
        questions: [
          {
            question: 'What is the target p99 latency for checkout?',
            whyItMatters: 'Sets the bar.',
            priority: 'high',
          },
          {
            question: 'Which traffic mix should the benchmark replay?',
            whyItMatters: 'Shapes the load test.',
            priority: 'medium',
          },
        ],
      });
    }
    return reply({
      questions: [
        {
          question: 'Is a staging environment available for load tests?',
          whyItMatters: 'Decides where experiments run.',
          priority: 'medium',
        },
      ],
    });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

async function started(): Promise<{ service: ResearchProposalService; session: ProposalSession }> {
  const store = new ProposalSessionStore(mkdtempSync(join(tmpdir(), 'hc-interview-')));
  const service = new ResearchProposalService(new InterviewGateway(), store, {});
  const session = await service.start({
    topic: 'Reduce p99 latency',
    contextPaths: [],
    contextRoot: mkdtempSync(join(tmpdir(), 'hc-interview-repo-')),
  });
  expect(session.stage).toBe('awaiting-answers');
  expect(session.questions.map((question) => question.id)).toEqual(['Q-001', 'Q-002', 'Q-003']);
  return { service, session };
}

function statuses(session: ProposalSession): Array<[string, string, string | undefined]> {
  return session.questions.map((question) => [question.id, question.status, question.answer]);
}

describe('runInterviewLoop', () => {
  const io = (options: MemoryIOOptions) => createMemoryIO({ interactive: true, ...options });

  it('asks each open question in priority order and finishes when no further round is wanted', async () => {
    const { service, session } = await started();
    const memory = io({ lines: ['200ms', '', 'skip'], confirms: [false] });

    const result = await runInterviewLoop(service, session.id, memory);

    expect(result.stage).toBe('interview-complete');
    expect(statuses(result)).toEqual([
      ['Q-001', 'answered', '200ms'],
      ['Q-002', 'skipped', undefined],
      ['Q-003', 'skipped', undefined],
    ]);
    expect(memory.questions.filter((question) => question.endsWith('> '))).toEqual([
      'Q-001> ',
      'Q-002> ',
      'Q-003> ',
    ]);
    expect(memory.questions).toContain('Round 1 answered. Ask the council for round 2 of 2?');
    expect(memory.text()).toContain('Q-001 [high] What is the target p99 latency for checkout?');
    expect(memory.text()).toContain('    why: Sets the bar.');
  });

  it('asks the council for another round when the person confirms', async () => {
    const { service, session } = await started();
    const memory = io({ lines: ['200ms', 'skip', 'skip'], confirms: [true] });

    const result = await runInterviewLoop(service, session.id, memory);

    expect(result.rounds).toHaveLength(2);
    expect(result.stage).toBe('interview-complete');
    expect(result.transcriptPath).toBeDefined();
  });

  it('pauses on /later or when no more input arrives, keeping the answers so far', async () => {
    const { service, session } = await started();
    const memory = io({ lines: ['200ms', '/later'] });

    const paused = await runInterviewLoop(service, session.id, memory);
    expect(paused.stage).toBe('awaiting-answers');
    expect(statuses(paused)).toEqual([
      ['Q-001', 'answered', '200ms'],
      ['Q-002', 'open', undefined],
      ['Q-003', 'open', undefined],
    ]);
    expect(memory.errLines).toContain(
      'Paused with 2 open question(s); /next continues the interview.'
    );

    const exhausted = await runInterviewLoop(service, session.id, io({ lines: ['replayed mix'] }));
    expect(statuses(exhausted)).toEqual([
      ['Q-001', 'answered', '200ms'],
      ['Q-002', 'answered', 'replayed mix'],
      ['Q-003', 'open', undefined],
    ]);
  });

  it('finishes early on /done, skipping the remaining questions', async () => {
    const { service, session } = await started();
    const result = await runInterviewLoop(service, session.id, io({ lines: ['/done'] }));
    expect(result.stage).toBe('interview-complete');
    expect(statuses(result).map(([, status]) => status)).toEqual(['skipped', 'skipped', 'skipped']);
  });

  it('applies supplied answers first and completes without a terminal', async () => {
    const { service, session } = await started();
    const memory = createMemoryIO({ interactive: false });

    const result = await runInterviewLoop(service, session.id, memory, {
      answers: { 'q-001': '200ms', 'Q-002': null, 'Q-003': 'yes, staging-2' },
    });

    expect(result.stage).toBe('interview-complete');
    expect(statuses(result)).toEqual([
      ['Q-001', 'answered', '200ms'],
      ['Q-002', 'skipped', undefined],
      ['Q-003', 'answered', 'yes, staging-2'],
    ]);
    expect(memory.questions).toEqual([]);
  });

  it('prints the open questions and a hint when it cannot ask', async () => {
    const { service, session } = await started();
    const memory = createMemoryIO({ interactive: false });

    const result = await runInterviewLoop(service, session.id, memory);

    expect(result.stage).toBe('awaiting-answers');
    expect(memory.outLines[0]).toBe('Round 1: 3 open questions.');
    expect(memory.text()).toContain(
      'Q-003 [medium] Is a staging environment available for load tests?'
    );
    expect(memory.errLines).toContain(NON_INTERACTIVE_INTERVIEW_HINT);
  });
});
