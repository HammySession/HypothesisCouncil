import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  handoffProposalMarkdown,
  nextHandoffId,
  prepareHandoff,
  updateHandoff,
} from '../../../src/research/proposal/handoff.js';
import { EXECUTOR_REPORT_BEGIN } from '../../../src/research/proposal/prompts.js';
import { ProposalSessionStore } from '../../../src/research/proposal/store.js';
import type { ProposalSession } from '../../../src/research/proposal/types.js';
import { AT, draft, draftOutput, proposalSession, question } from './fixtures.js';

function proposedSession(): ProposalSession {
  return proposalSession({
    stage: 'proposed',
    status: 'proposed',
    questions: [
      question('Q-001', 'What is the target p99?', { status: 'answered', answer: '200ms' }),
      question('Q-002', 'Is staging available?', { status: 'skipped', sources: ['duck-b'] }),
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
    drafts: [draft('D-001', 'duck-a', 'Alpha'), draft('D-002', 'duck-b', 'Beta')],
    proposal: {
      ...draftOutput('Merged'),
      source: 'synthesized',
      synthesizerProvider: 'duck-a',
      rationale: 'Alpha had the sharper kill criteria.',
      alternatives: ['D-002: Beta design'],
      createdAt: AT,
    },
  });
}

describe('proposal handoff', () => {
  it('writes the bundle, records the handoff, and keeps provider identities out of it', () => {
    const store = new ProposalSessionStore(mkdtempSync(join(tmpdir(), 'hc-handoff-')));
    const session = proposedSession();
    store.save(session);
    expect(nextHandoffId(session)).toBe('X-001');

    const bundle = prepareHandoff(store, session, {
      repositoryPath: '/repo/checkout',
      executor: {
        profile: 'claude',
        model: 'claude-x',
        promptDelivery: 'stdin',
        mode: 'full-auto',
      },
    });
    expect(bundle.record).toMatchObject({
      id: 'X-001',
      status: 'prepared',
      transport: 'prompt-only',
      repositoryPath: '/repo/checkout',
      executor: { profile: 'claude', model: 'claude-x' },
    });
    for (const file of [
      'proposal.md',
      'transcript.md',
      'context-manifest.json',
      'executor-prompt.md',
    ]) {
      expect(existsSync(join(bundle.directory, file))).toBe(true);
    }
    expect(bundle.record.promptPath).toBe(join(bundle.directory, 'executor-prompt.md'));
    expect(bundle.prompt).toContain('/repo/checkout');
    expect(bundle.prompt).toContain(EXECUTOR_REPORT_BEGIN);
    expect(bundle.prompt).toContain('Merged design');
    expect(bundle.prompt).toContain('hc-results/');
    expect(bundle.prompt).toContain('**A:** 200ms');
    expect(bundle.prompt).not.toContain('duck-a');
    expect(bundle.prompt).not.toContain('duck-b');

    const proposalMarkdown = readFileSync(join(bundle.directory, 'proposal.md'), 'utf8');
    expect(proposalMarkdown).toBe(handoffProposalMarkdown(session));
    expect(proposalMarkdown).toContain('# Merged design');
    expect(proposalMarkdown).toContain(
      '## Alternatives (not chosen; use only if the main design is killed)'
    );
    expect(proposalMarkdown).toContain('- D-002: Beta design');
    expect(proposalMarkdown).not.toContain('Alpha background');

    const loaded = store.load(session.id);
    expect(loaded.stage).toBe('handoff-prepared');
    expect(loaded.handoffs.map((item) => item.id)).toEqual(['X-001']);
    expect(
      prepareHandoff(store, loaded, { repositoryPath: '/repo', executor: { profile: 'codex' } })
        .record.id
    ).toBe('X-002');
  });

  it('updates a handoff record with a stage transition and rejects unknown ids', () => {
    const store = new ProposalSessionStore(mkdtempSync(join(tmpdir(), 'hc-handoff-')));
    const session = proposedSession();
    store.save(session);
    prepareHandoff(store, session, { repositoryPath: '/repo', executor: { profile: 'claude' } });

    const running = updateHandoff(
      store,
      session.id,
      'X-001',
      { status: 'running', logPath: '/log' },
      { stage: 'executing', status: 'running' }
    );
    expect(running.stage).toBe('executing');
    expect(running.status).toBe('running');
    expect(running.handoffs[0]).toMatchObject({ status: 'running', logPath: '/log' });

    const completed = updateHandoff(
      store,
      session.id,
      'X-001',
      { status: 'completed', exitCode: 0 },
      { stage: 'completed', status: 'completed' }
    );
    expect(store.load(session.id)).toMatchObject({ stage: 'completed', status: 'completed' });
    expect(completed.handoffs[0]).toMatchObject({
      status: 'completed',
      exitCode: 0,
      logPath: '/log',
    });
    expect(() => updateHandoff(store, session.id, 'X-009', {})).toThrow('Handoff not found: X-009');
  });

  it('refuses to hand off a proposal that has not been merged', () => {
    const store = new ProposalSessionStore(mkdtempSync(join(tmpdir(), 'hc-handoff-')));
    const session = proposalSession();
    store.save(session);
    expect(() =>
      prepareHandoff(store, session, { repositoryPath: '/repo', executor: { profile: 'claude' } })
    ).toThrow(`Proposal ${session.id} has no merged proposal yet`);
  });
});
