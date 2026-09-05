import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { jest } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { HypothesisCouncilServer } from '../src/server.js';
import { ResearchSessionStore } from '../src/research/store.js';
import type { ResearchSession } from '../src/research/types.js';
import type { CouncilRuntime } from '../src/runtime.js';

function session(store: ResearchSessionStore): ResearchSession {
  const now = '2026-08-20T00:00:00.000Z';
  const value: ResearchSession = {
    version: 1,
    id: 'RC-test',
    goal: 'Test a hypothesis',
    status: 'completed',
    stage: 'completed',
    createdAt: now,
    updatedAt: now,
    config: {
      providers: ['duck'],
      hypothesesPerProvider: 1,
      topK: 1,
      minProviders: 1,
      seed: 42,
      maxContextBytes: 1024,
      contextPaths: [],
      contextRoot: '/repository',
      markdownOnly: false,
      contextBudget: {
        maxBytes: 1024,
        limitingProvider: 'duck',
        providerLimits: [
          {
            provider: 'duck',
            model: 'test-model',
            contextWindowTokens: 128000,
            reservedOutputTokens: 32000,
            maxContextBytes: 1024,
            source: 'provider-default',
            transportLimited: false,
          },
        ],
      },
    },
    providers: ['duck'],
    unavailableProviders: [],
    contextManifest: {
      files: [],
      deniedPaths: [],
      omittedPaths: [],
      totalBytes: 0,
      includedBytes: 0,
      packetBytes: 0,
      maxBytes: 1024,
      packetSha256: 'hash',
    },
    candidates: [],
    reviews: [],
    falsifications: [],
    calls: [],
    warnings: [],
  };
  value.reportMarkdownPath = store.writeReport(value.id, 'report.md', '# Report');
  store.save(value);
  return value;
}

describe('HypothesisCouncilServer', () => {
  it('exposes only the project tools and closes operation runtimes', async () => {
    const store = new ResearchSessionStore(mkdtempSync(join(tmpdir(), 'hc-server-')));
    const saved = session(store);
    let closes = 0;
    const ask = jest.fn(() => Promise.resolve('Grounded answer'));
    const run = jest.fn(() => Promise.resolve(saved));
    const runtimeFactory = (): CouncilRuntime =>
      ({
        service: { ask, run } as never,
        proposals: {} as never,
        gateway: {} as never,
        close: () => {
          closes++;
          return Promise.resolve();
        },
      }) as CouncilRuntime;
    const server = new HypothesisCouncilServer(store, runtimeFactory, {
      HYPOTHESIS_COUNCIL_SKEPTICISM: 'high',
    });
    const client = new Client({ name: 'server-test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.start(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'duck_hypothesis_ask',
      'duck_hypothesis_council',
      'duck_hypothesis_report',
      'duck_hypothesis_status',
      'duck_research_proposal',
      'duck_research_proposal_answer',
      'duck_research_proposal_report',
    ]);

    const status = await client.callTool({
      name: 'duck_hypothesis_status',
      arguments: { session_id: saved.id },
    });
    expect(JSON.stringify(status.content)).toContain(saved.goal);

    const started = await client.callTool({
      name: 'duck_hypothesis_council',
      arguments: {
        goal: 'New goal',
        providers: ['duck'],
        hypotheses_per_provider: 2,
        novelty: 'low',
      },
    });
    expect(JSON.stringify(started.content)).toContain(saved.id);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: 'New goal',
        providers: ['duck'],
        hypothesesPerProvider: 2,
        dials: {
          novelty: 2,
          skepticism: 8,
          origins: { novelty: 'flag', skepticism: 'env' },
        },
      }),
      undefined,
      expect.any(AbortSignal)
    );

    const rejected = await client.callTool({
      name: 'duck_hypothesis_council',
      arguments: { goal: 'Bad dial', novelty: 11 },
    });
    expect(rejected.isError).toBe(true);
    expect(JSON.stringify(rejected.content)).toContain('novelty must be an integer from 0 to 10');

    const answer = await client.callTool({
      name: 'duck_hypothesis_ask',
      arguments: { session_id: saved.id, question: 'Why?' },
    });
    expect(JSON.stringify(answer.content)).toContain('Grounded answer');
    expect(ask).toHaveBeenCalledWith(saved.id, 'Why?', undefined, [], expect.any(AbortSignal));
    expect(closes).toBe(2);

    expect(readFileSync(saved.reportMarkdownPath!, 'utf8')).toContain('# Report');
    await client.close();
    await server.stop();
  });

  it('passes sources, scouts, and the web switch through to the research service', async () => {
    const store = new ResearchSessionStore(mkdtempSync(join(tmpdir(), 'hc-server-')));
    const saved = session(store);
    const run = jest.fn(() => Promise.resolve(saved));
    const runtimeFactory = (): CouncilRuntime =>
      ({
        service: { run } as never,
        proposals: {} as never,
        gateway: {} as never,
        close: () => Promise.resolve(),
      }) as CouncilRuntime;
    const server = new HypothesisCouncilServer(store, runtimeFactory, {});
    const client = new Client({ name: 'server-test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.start(serverTransport), client.connect(clientTransport)]);

    const started = await client.callTool({
      name: 'duck_hypothesis_council',
      arguments: {
        goal: 'Sourced goal',
        sources_file: 'docs/sources.md',
        scouts: ['cli-claude_scout'],
        web: 'off',
      },
    });
    expect(started.isError).toBeFalsy();
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: 'Sourced goal',
        sourcesFile: 'docs/sources.md',
        scouts: ['cli-claude_scout'],
        web: 'off',
      }),
      undefined,
      expect.any(AbortSignal)
    );

    const rejected = await client.callTool({
      name: 'duck_hypothesis_council',
      arguments: { goal: 'Bad web', web: 'maybe' },
    });
    expect(rejected.isError).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);

    await client.close();
    await server.stop();
  });
});
