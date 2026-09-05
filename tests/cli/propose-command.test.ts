import { existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { HANDOFF_CONFIRMATION_REQUIRED } from '../../src/cli/handoff-command.js';
import { NON_INTERACTIVE_INTERVIEW_HINT } from '../../src/cli/interview.js';
import { executeCommand } from '../../src/cli/main.js';
import {
  PROPOSAL_CONTEXT_CONFIRMATION_REQUIRED,
  normalizeDraftId,
  normalizeQuestionId,
  parseInlineAnswers,
} from '../../src/cli/propose-command.js';
import { parseArguments } from '../../src/cli/arguments.js';
import { EXECUTOR_REPORT_BEGIN, EXECUTOR_REPORT_END } from '../../src/research/proposal/prompts.js';
import { proposalStoreFor } from '../../src/research/proposal/store.js';
import { critiqueOutput, draftOutput } from '../research/proposal/fixtures.js';
import { createTestContext, createTestStore, type TestContextOptions } from './shell/fakes.js';

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
          question: 'What is the target p99 latency for checkout?',
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
          question: 'Is a staging environment available?',
          whyItMatters: 'Decides where experiments run.',
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
      rationale: 'Best of both drafts.',
      alternatives: ['Beta design'],
    }),
  },
  { promptStartsWith: 'proposal-grounded-ask:v1', content: 'Grounded answer' },
];

const EXECUTOR_SCRIPT = `
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  console.log('executing in ' + process.cwd());
  console.log('${EXECUTOR_REPORT_BEGIN}');
  console.log('## Summary');
  console.log('Prompt mentioned the proposal: ' + input.includes('Merged design'));
  console.log('${EXECUTOR_REPORT_END}');
});
`;

describe('hc propose', () => {
  it('parses inline answers and normalizes ids', () => {
    expect(normalizeQuestionId('q1')).toBe('Q-001');
    expect(normalizeQuestionId('Q-012')).toBe('Q-012');
    expect(normalizeDraftId('d2')).toBe('D-002');
    expect(
      parseInlineAnswers(['Q-001', '200ms', 'q2', 'skip'], parseArguments(['--skip', 'Q-003']))
    ).toEqual({
      'Q-001': '200ms',
      'Q-002': null,
      'Q-003': null,
    });
    expect(() => parseInlineAnswers(['Q-001'], parseArguments([]))).toThrow(
      'Missing answer for Q-001'
    );
    expect(() => parseInlineAnswers(['nope', 'x'], parseArguments([]))).toThrow(
      'Expected a question id'
    );
  });

  it('prints usage, requires confirmation without a terminal, and previews with --dry-run', async () => {
    const store = createTestStore();
    const ctx = createTestContext({ store, replies: REPLIES, io: { interactive: false } });

    expect(await executeCommand(['propose'], store, ctx)).toBe(0);
    expect(ctx.io.text()).toContain('hc propose "<topic>"');

    await expect(executeCommand(['propose', 'Reduce p99'], store, ctx)).rejects.toThrow(
      PROPOSAL_CONTEXT_CONFIRMATION_REQUIRED
    );
    expect(proposalStoreFor(store).list()).toEqual([]);

    ctx.io.outLines.length = 0;
    ctx.io.errLines.length = 0;
    expect(await executeCommand(['propose', 'Reduce p99', '--dry-run'], store, ctx)).toBe(0);
    expect(ctx.io.errLines).toContain('Topic: Reduce p99');
    expect(
      ctx.io.errLines.some((line) =>
        line.startsWith('Planned calls: 9 (4 interview, 2 drafts, 2 critiques, 1 synthesis)')
      )
    ).toBe(true);
    expect(ctx.io.errLines.at(-1)).toContain('Dry run:');
    expect(proposalStoreFor(store).list()).toEqual([]);
    expect(ctx.clients.flatMap((client) => client.asks)).toEqual([]);
  });

  it('runs the interview, drafting, and handoff through the subcommands', async () => {
    const store = createTestStore();
    const ctx = createTestContext({ store, replies: REPLIES, io: { interactive: false } });
    const proposals = proposalStoreFor(store);

    expect(
      await executeCommand(['propose', 'Reduce', 'p99', '--yes', '--no-draft'], store, ctx)
    ).toBe(0);
    const [session] = proposals.list();
    expect(session.stage).toBe('awaiting-answers');
    expect(ctx.io.text()).toContain('Q-001 [high] What is the target p99 latency for checkout?');
    expect(ctx.io.errLines).toContain(NON_INTERACTIVE_INTERVIEW_HINT);
    expect(ctx.progressFinished).toBeGreaterThan(0);

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['propose', 'list'], store, ctx)).toBe(0);
    expect(ctx.io.outLines).toEqual([`${session.id}  AWAITING-ANSWERS  Reduce p99`]);

    ctx.io.outLines.length = 0;
    ctx.io.errLines.length = 0;
    expect(
      await executeCommand(['propose', 'answer', 'Q-001', '200ms', '--skip', 'Q-002'], store, ctx)
    ).toBe(0);
    expect(ctx.io.errLines[0]).toContain('All questions answered');
    expect(ctx.io.text()).toContain('(0 open, 1 answered)');

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['propose', 'next'], store, ctx)).toBe(0);
    expect(proposals.load(session.id).stage).toBe('interview-complete');
    expect(proposals.load(session.id).rounds).toHaveLength(2);
    expect(ctx.io.text()).toContain('INTERVIEW-COMPLETE');

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['propose', 'questions', '--all'], store, ctx)).toBe(0);
    expect(ctx.io.text()).toContain(
      'Q-001 [high] (answered) What is the target p99 latency for checkout?'
    );
    expect(ctx.io.text()).toContain('    answer: 200ms');

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['propose', 'draft'], store, ctx)).toBe(0);
    const proposed = proposals.load(session.id);
    expect(proposed.stage).toBe('proposed');
    expect(ctx.io.text()).toContain('Proposal: Merged design (synthesized from the drafts)');
    expect(ctx.io.text()).toContain('1. D-001  Alpha design');

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['propose', 'report', '--json'], store, ctx)).toBe(0);
    const report = ctx.io.text();
    expect(report).toContain('Merged design');
    for (const key of ['authorProvider', 'reviewerProvider', 'synthesizerProvider', 'sources']) {
      expect(report).not.toContain(`"${key}"`);
    }

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['propose', 'show', 'D-001'], store, ctx)).toBe(0);
    expect(ctx.io.text()).toContain('# Draft D-001: Alpha design');
    await expect(executeCommand(['propose', 'show', 'D-009'], store, ctx)).rejects.toThrow(
      'Draft not found: D-009'
    );

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['propose', 'pick', 'd2'], store, ctx)).toBe(0);
    expect(ctx.io.text()).toContain('Proposal: Beta design (picked D-002)');

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['propose', 'ask', 'Why this order?'], store, ctx)).toBe(0);
    expect(ctx.io.outLines).toEqual(['Grounded answer']);

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['status', session.id], store, ctx)).toBe(0);
    expect(ctx.io.text()).toContain('Topic: Reduce p99');
    expect(ctx.io.text()).toContain('proposal: Beta design (picked)');

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['propose', 'status', '--json'], store, ctx)).toBe(0);
    const snapshot = JSON.parse(ctx.io.text()) as {
      id: string;
      drafts: Array<Record<string, unknown>>;
    };
    expect(snapshot.id).toBe(session.id);
    expect(snapshot.drafts[0]).not.toHaveProperty('authorProvider');

    // Handoff to a custom executor backed by a fake script.
    const scriptDir = mkdtempSync(join(tmpdir(), 'hc-exec-'));
    const script = join(scriptDir, 'executor.cjs');
    writeFileSync(script, EXECUTOR_SCRIPT, 'utf8');
    const env = {
      HYPOTHESIS_COUNCIL_EXECUTOR_FAKE_COMMAND: process.execPath,
      HYPOTHESIS_COUNCIL_EXECUTOR_FAKE_ARGS: script,
    };
    const handoffCtx = createTestContext({
      store,
      replies: REPLIES,
      env,
      cwd: ctx.cwd,
      io: { interactive: false },
    });

    expect(
      await executeCommand(['propose', 'handoff', '--to', 'fake', '--print'], store, handoffCtx)
    ).toBe(0);
    expect(handoffCtx.io.errLines[0]).toMatch(/^Handoff X-001 prepared: /);
    expect(handoffCtx.io.text()).toContain(EXECUTOR_REPORT_BEGIN);
    expect(handoffCtx.io.text()).toContain('Beta design');
    expect(proposals.load(session.id).stage).toBe('handoff-prepared');

    await expect(
      executeCommand(['propose', 'handoff', '--to', 'fake', '--run'], store, handoffCtx)
    ).rejects.toThrow(HANDOFF_CONFIRMATION_REQUIRED);

    handoffCtx.io.outLines.length = 0;
    handoffCtx.io.errLines.length = 0;
    expect(
      await executeCommand(['handoff', '--to', 'fake', '--run', '--yes'], store, handoffCtx)
    ).toBe(0);
    expect(handoffCtx.io.errLines).toContain(
      'Could not check the repository for uncommitted changes (git status failed).'
    );
    expect(handoffCtx.io.errLines).toContain(`executing in ${ctx.cwd}`);
    const done = proposals.load(session.id);
    expect(done.stage).toBe('completed');
    expect(done.status).toBe('completed');
    const record = done.handoffs.at(-1)!;
    expect(record).toMatchObject({
      id: 'X-003',
      status: 'completed',
      exitCode: 0,
      transport: 'spawned',
    });
    expect(existsSync(record.logPath!)).toBe(true);
    expect(existsSync(record.resultPath!)).toBe(true);
    expect(handoffCtx.io.text()).toContain('Handoff: X-003 → fake (completed)');

    // A dirty repository blocks --run unless --allow-dirty is given.
    const dirtyCtx = createTestContext({
      store,
      env,
      cwd: ctx.cwd,
      io: { interactive: false },
      runVendorCommand: () => Promise.resolve({ stdout: ' M src/app.ts\n', stderr: '', code: 0 }),
    });
    await expect(
      executeCommand(['propose', 'handoff', '--to', 'fake', '--run', '--yes'], store, dirtyCtx)
    ).rejects.toThrow('Repository has uncommitted changes');
    expect(
      await executeCommand(
        ['propose', 'handoff', '--to', 'fake', '--run', '--yes', '--allow-dirty'],
        store,
        dirtyCtx
      )
    ).toBe(0);
    expect(() =>
      executeCommand(['propose', 'handoff', '--to', 'nope'], store, dirtyCtx)
    ).rejects.toThrow('Unknown executor: nope');
  }, 30_000);

  it('starts without an interview and drafts immediately with --no-interview', async () => {
    const store = createTestStore();
    const ctx = createTestContext({ store, replies: REPLIES, io: { interactive: false } });

    expect(
      await executeCommand(
        ['propose', 'Reduce p99', '--yes', '--no-interview', '--json'],
        store,
        ctx
      )
    ).toBe(0);
    const [session] = proposalStoreFor(store).list();
    expect(session.stage).toBe('proposed');
    expect(session.config.interview).toBe(false);
    expect(session.questions).toEqual([]);
    const printed = JSON.parse(ctx.io.text()) as { proposal: { title: string } };
    expect(printed.proposal.title).toBe('Merged design');
    const prompts = ctx.clients.flatMap((client) => client.asks.map((ask) => ask.prompt));
    expect(prompts.some((prompt) => prompt.startsWith('proposal-interview:v1'))).toBe(false);
  });
});
