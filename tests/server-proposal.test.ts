import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { proposalStoreFor } from '../src/research/proposal/store.js';
import type { ProposalSession } from '../src/research/proposal/types.js';
import { ResearchSessionStore } from '../src/research/store.js';
import type { CouncilRuntime } from '../src/runtime.js';
import { HypothesisCouncilServer } from '../src/server.js';
import { AT, draftOutput, proposalSession, question } from './research/proposal/fixtures.js';

function contentText(result: { content?: unknown }): string {
  const content = result.content as Array<{ type: string; text?: string }> | undefined;
  return content?.map((item) => item.text ?? '').join('\n') ?? '';
}

describe('research proposal MCP tools', () => {
  it('starts, answers, drafts, and reports proposals without exposing provider identities', async () => {
    const store = new ResearchSessionStore(mkdtempSync(join(tmpdir(), 'hc-server-proposal-')));
    const proposals = proposalStoreFor(store);
    const awaiting = proposalSession({
      id: 'RP-20260904-000000Z-aaa111',
      questions: [question('Q-001', 'What is the target p99?')],
      rounds: [
        {
          round: 1,
          askedProviders: ['duck-a', 'duck-b'],
          doneProviders: [],
          questionIds: ['Q-001'],
          createdAt: AT,
        },
      ],
    });
    const proposed = proposalSession({
      id: 'RP-20260904-000000Z-bbb222',
      stage: 'proposed',
      status: 'proposed',
      proposal: {
        ...draftOutput('Merged'),
        source: 'synthesized',
        synthesizerProvider: 'duck-a',
        alternatives: [],
        createdAt: AT,
      },
    });
    proposals.save(proposed);
    proposals.save(awaiting);

    const calls: Array<[string, unknown]> = [];
    let closes = 0;
    const runtimeFactory = (): CouncilRuntime =>
      ({
        service: {} as never,
        gateway: {} as never,
        proposals: {
          store: proposals,
          start: (input: unknown) => {
            calls.push(['start', input]);
            return Promise.resolve(awaiting);
          },
          answer: (id: string, answers: unknown) => {
            calls.push(['answer', { id, answers }]);
            return {
              ...awaiting,
              stage: 'interview-complete',
              status: 'waiting',
            } as ProposalSession;
          },
          draft: (id: string) => {
            calls.push(['draft', id]);
            return Promise.resolve(proposed);
          },
          nextRound: (id: string) => {
            calls.push(['nextRound', id]);
            return Promise.resolve(awaiting);
          },
          finishInterview: (id: string) => {
            calls.push(['finishInterview', id]);
            return {
              ...awaiting,
              stage: 'interview-complete',
              status: 'waiting',
            } as ProposalSession;
          },
        } as never,
        close: () => {
          closes++;
          return Promise.resolve();
        },
      }) as CouncilRuntime;
    const server = new HypothesisCouncilServer(store, runtimeFactory, {});
    const client = new Client({ name: 'proposal-test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.start(serverTransport), client.connect(clientTransport)]);

    const started = await client.callTool({
      name: 'duck_research_proposal',
      arguments: { topic: 'Reduce p99', context_paths: ['src'], max_rounds: 1, skepticism: 'high' },
    });
    expect(started.isError).toBeFalsy();
    expect(contentText(started)).toContain('"Q-001"');
    expect(contentText(started)).not.toContain('"sources"');
    expect(calls[0][0]).toBe('start');
    expect(calls[0][1]).toMatchObject({
      topic: 'Reduce p99',
      contextPaths: ['src'],
      maxRounds: 1,
      dials: { skepticism: 8 },
    });
    expect(calls).toHaveLength(1);

    calls.length = 0;
    const answered = await client.callTool({
      name: 'duck_research_proposal',
      arguments: { topic: 'Reduce p99', answers: { 'Q-001': '200ms' } },
    });
    expect(calls.map(([name]) => name)).toEqual(['start', 'answer', 'draft']);
    expect(contentText(answered)).toContain('Merged design');
    expect(contentText(answered)).not.toContain('synthesizerProvider');

    calls.length = 0;
    const later = await client.callTool({
      name: 'duck_research_proposal_answer',
      arguments: { session_id: awaiting.id, answers: { 'Q-001': null }, draft: false },
    });
    expect(later.isError).toBeFalsy();
    expect(calls).toEqual([['answer', { id: awaiting.id, answers: { 'Q-001': null } }]]);

    calls.length = 0;
    await client.callTool({
      name: 'duck_research_proposal_answer',
      arguments: { session_id: awaiting.id, finish: true },
    });
    expect(calls.map(([name]) => name)).toEqual(['finishInterview', 'draft']);

    const report = await client.callTool({
      name: 'duck_research_proposal_report',
      arguments: { session_id: proposed.id },
    });
    expect(report.isError).toBeFalsy();
    expect(contentText(report)).toContain('# Research proposal: Merged design');
    expect(contentText(report)).not.toContain('duck-a');

    const notReady = await client.callTool({
      name: 'duck_research_proposal_report',
      arguments: { session_id: awaiting.id },
    });
    expect(notReady.isError).toBe(true);
    expect(contentText(notReady)).toContain(`Proposal is not ready for ${awaiting.id}`);

    expect(closes).toBe(4);
    await client.close();
    await server.stop();
  });
});
