import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SHELL_COMMANDS } from '../../../src/cli/shell/commands/index.js';
import { createShellCompleter } from '../../../src/cli/shell/completer.js';
import { NO_PROPOSAL_SELECTED } from '../../../src/cli/shell/proposal-scope.js';
import { dispatchShellLine } from '../../../src/cli/shell/registry.js';
import { EXECUTOR_REPORT_BEGIN } from '../../../src/research/proposal/prompts.js';
import { proposalStoreFor } from '../../../src/research/proposal/store.js';
import { critiqueOutput, draftOutput } from '../../research/proposal/fixtures.js';
import {
  createTestContext,
  createTestStore,
  seedSession,
  type TestContextOptions,
} from './fakes.js';

const REPLIES: NonNullable<TestContextOptions['replies']> = [
  { promptStartsWith: 'Reply with exactly READY', content: 'READY' },
  {
    promptStartsWith: 'proposal-interview:v1',
    promptIncludes: 'ROUND 2 OF',
    content: JSON.stringify({ questions: [], done: true }),
  },
  {
    provider: 'duck-a',
    promptStartsWith: 'proposal-interview:v1',
    content: JSON.stringify({
      questions: [
        {
          question: 'What is the target p99 latency?',
          whyItMatters: 'Sets the bar.',
          priority: 'high',
        },
      ],
    }),
  },
  {
    provider: 'duck-b',
    promptStartsWith: 'proposal-interview:v1',
    content: JSON.stringify({
      questions: [
        {
          question: 'Is staging available?',
          whyItMatters: 'Decides where to run.',
          priority: 'medium',
        },
      ],
    }),
  },
  {
    provider: 'duck-a',
    promptStartsWith: 'proposal-draft:v1',
    content: JSON.stringify(draftOutput('Alpha')),
  },
  {
    provider: 'duck-b',
    promptStartsWith: 'proposal-draft:v1',
    content: JSON.stringify(draftOutput('Beta')),
  },
  { promptStartsWith: 'proposal-critique:v1', content: JSON.stringify(critiqueOutput()) },
  {
    promptStartsWith: 'proposal-synthesis:v1',
    content: JSON.stringify({
      ...draftOutput('Merged'),
      rationale: 'Best of both.',
      alternatives: [],
    }),
  },
  { promptStartsWith: 'proposal-grounded-ask:v1', content: 'Grounded answer' },
  { promptStartsWith: 'session-grounded-ask', content: 'Council answer' },
];

describe('proposal shell commands', () => {
  it('interviews at the prompt, drafts, and answers grounded questions about the proposal', async () => {
    const store = createTestStore();
    const ctx = createTestContext({
      store,
      replies: REPLIES,
      io: { interactive: true, lines: ['200ms', 'skip'], confirms: [false] },
    });
    const proposals = proposalStoreFor(store);

    await expect(dispatchShellLine(ctx, '/questions')).rejects.toThrow(NO_PROPOSAL_SELECTED);

    await dispatchShellLine(ctx, '/propose "Reduce p99" --no-draft');
    const [session] = proposals.list();
    expect(ctx.state.selectedSession).toBe(session.id);
    expect(session.stage).toBe('interview-complete');
    expect(ctx.io.questions.filter((question) => question.endsWith('> '))).toEqual([
      'Q-001> ',
      'Q-002> ',
    ]);
    expect(ctx.io.errLines).toContain('Topic: Reduce p99');
    expect(ctx.io.text()).toContain('INTERVIEW-COMPLETE');

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/status');
    expect(ctx.io.text()).toContain('(0 open, 1 answered)');

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/draft');
    expect(proposals.load(session.id).stage).toBe('proposed');
    expect(ctx.io.text()).toContain('Proposal: Merged design (synthesized from the drafts)');

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/proposal drafts');
    expect(ctx.io.outLines[0]).toMatch(/^1\. D-00[12]  (Alpha|Beta) design/);

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/proposal D-002');
    expect(ctx.io.text()).toContain('# Draft D-002: Beta design');

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/proposal json');
    expect(ctx.io.text()).toContain('"kind": "proposal"');
    expect(ctx.io.text()).not.toContain('authorProvider');

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/pick D-001');
    expect(ctx.io.text()).toContain('Proposal: Alpha design (picked D-001)');

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/report');
    expect(ctx.io.outLines[0]).toBe('# Research proposal: Alpha design');
    await expect(dispatchShellLine(ctx, '/report html')).rejects.toThrow(
      'Proposals have no HTML report yet'
    );

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, 'What should run first?');
    expect(ctx.io.outLines).toEqual(['Grounded answer']);
    const asks = ctx.clients.flatMap((client) => client.asks);
    expect(asks.at(-1)?.prompt.startsWith('proposal-grounded-ask:v1')).toBe(true);
    expect(asks.at(-1)?.provider).toBe('duck-a');

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/proposals');
    expect(ctx.io.outLines).toEqual([`${session.id}  PROPOSED  Reduce p99`]);

    // Switching between a council session and the proposal with /use.
    const council = seedSession(store);
    await dispatchShellLine(ctx, `/use ${council.id}`);
    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/status');
    expect(ctx.io.text()).toContain(council.id);
    await dispatchShellLine(ctx, `/use ${session.id}`);
    expect(ctx.state.selectedSession).toBe(session.id);
    expect(proposals.currentId()).toBe(session.id);
  });

  it('pauses the interview, answers question by question, and resumes with /next and /done', async () => {
    const store = createTestStore();
    const ctx = createTestContext({
      store,
      replies: REPLIES,
      io: { interactive: true, lines: ['/later'] },
    });
    const proposals = proposalStoreFor(store);

    await dispatchShellLine(ctx, '/propose "Reduce p99"');
    const [session] = proposals.list();
    expect(session.stage).toBe('awaiting-answers');
    expect(ctx.io.errLines).toContain(
      'Paused with 2 open question(s); /next continues the interview.'
    );

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/questions');
    expect(ctx.io.outLines).toEqual([
      'Q-001 [high] What is the target p99 latency?',
      '    why: Sets the bar.',
      'Q-002 [medium] Is staging available?',
      '    why: Decides where to run.',
    ]);

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/answer Q-001 under 200ms at p99');
    expect(ctx.io.outLines).toEqual(['Q-001 recorded; 1 open question left.']);
    expect(proposals.load(session.id).questions[0].answer).toBe('under 200ms at p99');

    await dispatchShellLine(ctx, '/answer q2 skip');
    expect(ctx.io.outLines.at(-1)).toBe(
      'Q-002 recorded; 0 open questions left. /next asks for another round, /done drafts.'
    );

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/next');
    expect(proposals.load(session.id).rounds).toHaveLength(2);
    expect(proposals.load(session.id).stage).toBe('interview-complete');

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/done');
    expect(proposals.load(session.id).stage).toBe('proposed');
    expect(ctx.io.text()).toContain('Proposal: Merged design');

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/resume');
    expect(ctx.io.text()).toContain('Proposal: Merged design');
  });

  it('completes proposal ids, draft ids, open question ids, and executor names', async () => {
    const store = createTestStore();
    const ctx = createTestContext({
      store,
      replies: REPLIES,
      io: { interactive: true, lines: ['/later'] },
    });
    await dispatchShellLine(ctx, '/propose "Reduce p99"');
    const [session] = proposalStoreFor(store).list();
    const complete = createShellCompleter(ctx, () => SHELL_COMMANDS);

    expect(complete('/use RP')).toEqual([[session.id], 'RP']);
    expect(complete('/answer Q')).toEqual([['Q-001', 'Q-002'], 'Q']);
    expect(complete('/handoff c')).toEqual([['claude', 'codex'], 'c']);
    expect(complete('/proposal ')).toEqual([['drafts', 'json'], '']);
    expect(complete('/prop')).toEqual([['/proposal', '/proposals', '/propose'], '/prop']);
    expect(complete('@duck-')).toEqual([['@duck-a', '@duck-b'], '@duck-']);
  });

  it('hands a proposal off to an executor from the shell', async () => {
    const store = createTestStore();
    const scriptDir = mkdtempSync(join(tmpdir(), 'hc-exec-'));
    const script = join(scriptDir, 'executor.cjs');
    writeFileSync(
      script,
      `process.stdin.resume(); process.stdin.on('end', () => { console.log('${EXECUTOR_REPORT_BEGIN}'); console.log('## Summary'); console.log('ran'); console.log('===== HC EXECUTOR REPORT END ====='); });`,
      'utf8'
    );
    const ctx = createTestContext({
      store,
      replies: REPLIES,
      env: {
        HYPOTHESIS_COUNCIL_EXECUTOR_FAKE_COMMAND: process.execPath,
        HYPOTHESIS_COUNCIL_EXECUTOR_FAKE_ARGS: script,
      },
      io: { interactive: true, confirms: [true] },
    });
    await dispatchShellLine(ctx, '/propose "Reduce p99" --no-interview');
    const proposals = proposalStoreFor(store);
    const [session] = proposals.list();
    expect(session.stage).toBe('proposed');

    await expect(dispatchShellLine(ctx, '/handoff')).rejects.toThrow('Usage: /handoff NAME');

    ctx.io.outLines.length = 0;
    ctx.io.errLines.length = 0;
    await dispatchShellLine(ctx, '/handoff fake --print');
    expect(ctx.io.errLines[0]).toMatch(/^Handoff X-001 prepared: /);
    expect(ctx.io.text()).toContain(EXECUTOR_REPORT_BEGIN);

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/handoff fake --run --allow-dirty');
    expect(ctx.io.questions.at(-1)).toBe(
      `Run fake in ${ctx.state.repoRoot} with full-auto permissions?`
    );
    const done = proposals.load(session.id);
    expect(done.stage).toBe('completed');
    expect(done.handoffs.at(-1)).toMatchObject({ id: 'X-002', status: 'completed', exitCode: 0 });
    expect(ctx.io.text()).toContain('Handoff: X-002 -> fake (completed)');
  }, 30_000);
});
