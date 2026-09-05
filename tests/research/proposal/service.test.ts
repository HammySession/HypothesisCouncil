import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ResearchProposalService,
  planProposalCalls,
} from '../../../src/research/proposal/service.js';
import { ProposalSessionStore } from '../../../src/research/proposal/store.js';
import { ResearchSessionStore } from '../../../src/research/store.js';
import type {
  ProviderDescriptor,
  ResearchCompletion,
  ResearchCompletionOptions,
  ResearchProgress,
  ResearchProviderGateway,
  ResearchSession,
} from '../../../src/research/types.js';
import { critiqueOutput, draftOutput } from './fixtures.js';

interface Recorded {
  provider: string;
  prompt: string;
  cwd: string;
}

class ProposalGateway implements ResearchProviderGateway {
  readonly prompts: Recorded[] = [];
  /** Providers whose draft call fails until cleared. */
  failDrafts = new Set<string>();
  failSynthesis = false;

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

  complete(
    provider: string,
    prompt: string,
    options: ResearchCompletionOptions
  ): Promise<ResearchCompletion> {
    this.prompts.push({ provider, prompt, cwd: options.workingDirectory });
    const reply = (content: string) => Promise.resolve({ content, model: `${provider}-model` });
    if (prompt.startsWith('proposal-interview:v1')) {
      if (prompt.includes('ROUND 2 OF')) {
        return reply(JSON.stringify({ questions: [], done: true }));
      }
      if (provider === 'duck-a')
        return reply(
          'Here you go:\n```json\n{"questions": [{"question": "What is the target p99 latency for checkout?", "whyItMatters": "Sets the success bar.", "priority": "high"}]}\n```'
        );
      return reply(
        JSON.stringify({
          questions: [
            {
              question: 'What is the target p99 latency for checkout today?',
              whyItMatters: 'Sets the bar.',
              priority: 'medium',
            },
            {
              question: 'Which regions carry the most traffic?',
              whyItMatters: 'Chooses where to measure.',
              priority: 'low',
            },
          ],
        })
      );
    }
    if (prompt.startsWith('proposal-draft:v1')) {
      if (this.failDrafts.has(provider)) return Promise.reject(new Error('provider down'));
      if (provider === 'duck-a') return reply('not json at all');
      return reply(JSON.stringify(draftOutput('Beta')));
    }
    if (prompt.startsWith('proposal-draft-repair:v1')) {
      return reply(JSON.stringify(draftOutput('Alpha')));
    }
    if (prompt.startsWith('proposal-critique:v1')) {
      const alpha = prompt.includes('Alpha design');
      return reply(
        JSON.stringify(
          critiqueOutput(alpha ? { feasibility: 4, rigor: 4, verdict: 'uncertain' } : {})
        )
      );
    }
    if (prompt.startsWith('proposal-synthesis:v1')) {
      if (this.failSynthesis) return Promise.reject(new Error('synthesis down'));
      return reply(
        JSON.stringify({
          ...draftOutput('Merged'),
          rationale: 'Beta measured first.',
          alternatives: ['Alpha kept as fallback'],
        })
      );
    }
    if (prompt.startsWith('proposal-grounded-ask:v1')) {
      return reply('A grounded proposal answer.');
    }
    throw new Error(`Unexpected prompt: ${prompt.slice(0, 60)}`);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

function createService(gateway = new ProposalGateway()) {
  const root = mkdtempSync(join(tmpdir(), 'hc-proposal-'));
  const councilStore = new ResearchSessionStore(root);
  const store = new ProposalSessionStore(root);
  return {
    gateway,
    root,
    store,
    councilStore,
    service: new ResearchProposalService(gateway, store, { councilStore }),
  };
}

describe('planProposalCalls', () => {
  it('bounds interview, draft, critique, and synthesis calls', () => {
    expect(planProposalCalls(3, 2, true, 'synthesize')).toEqual({
      interview: 6,
      drafts: 3,
      critiques: 3,
      synthesis: 1,
      total: 13,
    });
    expect(planProposalCalls(1, 2, false, 'synthesize').total).toBe(2);
    expect(planProposalCalls(2, 1, true, 'pick')).toMatchObject({ synthesis: 0, total: 6 });
  });
});

describe('ResearchProposalService', () => {
  it('interviews in sealed rounds, drafts, critiques blind, and merges', async () => {
    const { service, gateway, store, root } = createService();
    const repository = mkdtempSync(join(tmpdir(), 'hc-repo-'));
    writeFileSync(join(repository, 'README.md'), '# Checkout\nThe p99 is 900ms.');
    const events: ResearchProgress[] = [];
    let previewed = 0;

    const started = await service.start(
      {
        topic: 'Reduce p99 latency of the checkout service',
        contextRoot: repository,
        contextPaths: ['README.md'],
        seed: 7,
      },
      (event) => void events.push(event),
      undefined,
      (preview) => {
        previewed++;
        expect(preview.providers).toEqual(['duck-a', 'duck-b']);
        expect(preview.plannedCalls).toEqual({
          interview: 4,
          drafts: 2,
          critiques: 2,
          synthesis: 1,
          total: 9,
        });
        expect(preview.contextManifest.files.map((file) => file.path)).toEqual(['README.md']);
      }
    );
    expect(previewed).toBe(1);
    expect(started.id.startsWith('RP-')).toBe(true);
    expect(store.currentId()).toBe(started.id);
    expect(started.stage).toBe('awaiting-answers');
    expect(started.status).toBe('waiting');
    expect(started.questions.map((q) => [q.id, q.askedByCount, q.status])).toEqual([
      ['Q-001', 2, 'open'],
      ['Q-002', 1, 'open'],
    ]);
    expect(started.rounds).toHaveLength(1);
    // Every interview call ran in the session directory with the context and no other provider's text.
    const round1 = gateway.prompts.filter((call) => call.prompt.includes('ROUND 1 OF'));
    expect(round1).toHaveLength(2);
    for (const call of round1) {
      expect(call.cwd).toBe(store.sessionDirectory(started.id));
      expect(call.prompt).toContain('The p99 is 900ms.');
      expect(call.prompt).not.toContain('ANSWERS SO FAR');
    }
    // The fenced reply parsed without a repair call.
    expect(started.calls.filter((call) => call.stage === 'interview-repair')).toHaveLength(0);
    expect(
      existsSync(join(root, started.id, 'calls', 'interview', 'interview-r1-duck-a.raw.json'))
    ).toBe(true);

    // Answers never contact a provider.
    const before = gateway.prompts.length;
    const answered = service.answer(started.id, { 'Q-001': '200ms at the edge', 'q-002': null });
    expect(gateway.prompts.length).toBe(before);
    expect(answered.questions.map((q) => q.status)).toEqual(['answered', 'skipped']);
    expect(answered.stage).toBe('awaiting-answers');

    // Round two: sealed providers see only their own questions with the answers.
    const round2 = await service.nextRound(started.id);
    expect(round2.stage).toBe('interview-complete');
    expect(round2.transcriptPath).toBeDefined();
    const promptsRound2 = gateway.prompts.filter((call) => call.prompt.includes('ROUND 2 OF'));
    const duckA = promptsRound2.find((call) => call.provider === 'duck-a')!;
    const duckB = promptsRound2.find((call) => call.provider === 'duck-b')!;
    expect(duckA.prompt).toContain('ANSWERS SO FAR');
    expect(duckA.prompt).toContain('A: 200ms at the edge');
    expect(duckA.prompt).not.toContain('Which regions carry the most traffic?');
    expect(duckB.prompt).toContain('Which regions carry the most traffic?');
    expect(duckB.prompt).toContain('A: (the person skipped this question)');
    expect(duckB.prompt).not.toContain('duck-a');

    // Drafting: identical sealed prompts, a repair for duck-a, blind critiques by the other member.
    const proposed = await service.draft(started.id, (event) => void events.push(event));
    expect(proposed.stage).toBe('proposed');
    expect(proposed.status).toBe('proposed');
    expect(proposed.drafts.map((d) => [d.id, d.authorProvider, d.title, d.rank])).toEqual([
      ['D-001', 'duck-a', 'Alpha design', 2],
      ['D-002', 'duck-b', 'Beta design', 1],
    ]);
    const draftPrompts = gateway.prompts.filter((call) =>
      call.prompt.startsWith('proposal-draft:v1')
    );
    expect(draftPrompts).toHaveLength(2);
    expect(draftPrompts[0]!.prompt).toBe(draftPrompts[1]!.prompt);
    expect(draftPrompts[0]!.prompt).toContain(
      'Q-001 (round 1, high): What is the target p99 latency for checkout?\nA: 200ms at the edge'
    );
    expect(proposed.calls.some((call) => call.stage === 'proposal-draft-repair')).toBe(true);
    expect(proposed.critiques.map((c) => [c.draftId, c.reviewerProvider, c.selfReview])).toEqual([
      ['D-001', 'duck-b', false],
      ['D-002', 'duck-a', false],
    ]);
    const critiquePrompts = gateway.prompts.filter((call) =>
      call.prompt.startsWith('proposal-critique:v1')
    );
    for (const call of critiquePrompts) {
      expect(call.prompt).not.toContain('authorProvider');
      expect(call.prompt).not.toContain('duck-');
    }
    expect(proposed.proposal).toMatchObject({
      source: 'synthesized',
      title: 'Merged design',
      synthesizerModel: expect.stringContaining('-model'),
      alternatives: ['Alpha kept as fallback'],
    });
    const synthesis = gateway.prompts.find((call) =>
      call.prompt.startsWith('proposal-synthesis:v1')
    )!;
    expect(synthesis.prompt).toContain('"rank": 1');
    expect(synthesis.prompt).not.toContain('duck-');
    expect(synthesis.prompt).not.toContain('reviewerProvider');

    // Artifacts.
    const proposalJson = readFileSync(proposed.proposalJsonPath!, 'utf8');
    for (const key of ['authorProvider', 'reviewerProvider', 'synthesizerProvider', 'sources']) {
      expect(proposalJson).not.toContain(`"${key}"`);
    }
    expect(readFileSync(proposed.proposalMarkdownPath!, 'utf8')).toContain(
      '# Research proposal: Merged design'
    );
    expect(readFileSync(proposed.transcriptPath!, 'utf8')).toContain('**A:** 200ms at the edge');
    expect(events.map((event) => event.stage)).toEqual(
      expect.arrayContaining([
        'preflight',
        'interviewing',
        'drafting',
        'critiquing',
        'synthesizing',
      ])
    );

    // Grounded ask and pick.
    await expect(service.ask(started.id, 'Why Beta?', 'duck-b')).resolves.toBe(
      'A grounded proposal answer.'
    );
    expect(store.load(started.id).calls.some((call) => call.stage === 'proposal-ask')).toBe(true);
    await expect(service.ask(started.id, 'x', 'duck-z')).rejects.toThrow('not part of proposal');
    const picked = service.pick(started.id, 'd-001');
    expect(picked.proposal).toMatchObject({
      source: 'picked',
      sourceDraftId: 'D-001',
      title: 'Alpha design',
      alternatives: ['D-002: Beta design'],
    });
    expect(() => service.pick(started.id, 'D-009')).toThrow(
      'Unknown draft: D-009 (available: D-001, D-002)'
    );
  });

  it('refuses to draft or advance while questions are open, and can end the interview early', async () => {
    const { service } = createService();
    const session = await service.start({ topic: 'A topic', interviewVisibility: 'visible' });
    await expect(service.draft(session.id)).rejects.toThrow('interview is still open');
    await expect(service.nextRound(session.id)).rejects.toThrow(
      'Answer or skip the open questions first: Q-001, Q-002'
    );
    expect(() => service.answer(session.id, { 'Q-009': 'x' })).toThrow('Unknown question: Q-009');
    const finished = service.finishInterview(session.id);
    expect(finished.stage).toBe('interview-complete');
    expect(finished.questions.every((q) => q.status === 'skipped')).toBe(true);
    expect(existsSync(finished.transcriptPath!)).toBe(true);
    expect(() => service.finishInterview(session.id)).not.toThrow();
  });

  it('skips the interview on request and picks the top draft when synthesis fails', async () => {
    const gateway = new ProposalGateway();
    gateway.failSynthesis = true;
    const { service } = createService(gateway);
    const started = await service.start({ topic: 'A topic', interview: false, seed: 1 });
    expect(started.stage).toBe('interview-complete');
    expect(
      gateway.prompts.filter((call) => call.prompt.startsWith('proposal-interview'))
    ).toHaveLength(0);
    const proposed = await service.draft(started.id);
    expect(proposed.proposal).toMatchObject({ source: 'picked', sourceDraftId: 'D-002' });
    expect(proposed.warnings.some((w) => w.startsWith('Synthesis failed'))).toBe(true);
  });

  it('uses pick mode without a synthesis call', async () => {
    const { service, gateway } = createService();
    const started = await service.start({
      topic: 'A topic',
      interview: false,
      mergeStrategy: 'pick',
    });
    const proposed = await service.draft(started.id);
    expect(proposed.proposal?.source).toBe('picked');
    expect(gateway.prompts.some((call) => call.prompt.startsWith('proposal-synthesis'))).toBe(
      false
    );
  });

  it('fails when no draft succeeds and resumes from the drafting stage', async () => {
    const gateway = new ProposalGateway();
    gateway.failDrafts = new Set(['duck-a', 'duck-b']);
    const { service, store } = createService(gateway);
    const started = await service.start({ topic: 'A topic', interview: false });
    await expect(service.draft(started.id)).rejects.toThrow(
      'No provider produced a proposal draft'
    );
    const failed = store.load(started.id);
    expect(failed.status).toBe('failed');
    expect(failed.stage).toBe('drafting');
    expect(failed.error).toBe('No provider produced a proposal draft');
    gateway.failDrafts.clear();
    const resumed = await service.resume(started.id);
    expect(resumed.status).toBe('proposed');
    expect(resumed.error).toBeUndefined();
    expect(resumed.drafts).toHaveLength(2);
  });

  it('marks an aborted run interrupted and resumes the interview round', async () => {
    const gateway = new ProposalGateway();
    const controller = new AbortController();
    const original = gateway.complete.bind(gateway);
    gateway.complete = (provider, prompt, options) => {
      controller.abort();
      return original(provider, prompt, options);
    };
    const { service, store } = createService(gateway);
    await expect(
      service.start({ topic: 'A topic' }, undefined, controller.signal)
    ).rejects.toThrow();
    const interrupted = store.list()[0]!;
    expect(interrupted.status).toBe('interrupted');
    gateway.complete = original;
    const resumed = await service.resume(interrupted.id);
    expect(resumed.stage).toBe('awaiting-answers');
    expect(resumed.rounds).toHaveLength(1);
  });

  it('seeds a proposal from a council session without leaking authors', async () => {
    const { service, councilStore, gateway } = createService();
    const council = {
      version: 1,
      id: 'RC-20260827-000000Z-abc123',
      goal: 'Explain the drift',
      status: 'completed',
      stage: 'completed',
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z',
      config: {
        providers: ['duck-a'],
        hypothesesPerProvider: 1,
        topK: 1,
        minProviders: 1,
        seed: 1,
        maxContextBytes: 4096,
        contextPaths: ['docs'],
        contextRoot: mkdtempSync(join(tmpdir(), 'hc-council-root-')),
        markdownOnly: true,
        contextBudget: { maxBytes: 4096, limitingProvider: 'duck-a', providerLimits: [] },
      },
      providers: ['duck-a'],
      unavailableProviders: [],
      contextManifest: {
        requestedPaths: [],
        files: [],
        totalBytes: 0,
        maxBytes: 4096,
        truncated: false,
      },
      candidates: [
        {
          id: 'H-001',
          sessionId: 'RC-1',
          generationIndex: 0,
          authorProvider: 'duck-a',
          status: 'distinct',
          rank: 1,
          createdAt: '2026-08-27T00:00:00.000Z',
          title: 'Clock drift reorders events',
          claim: 'claim',
          mechanism: 'mechanism',
          predictions: ['p'],
          assumptions: [],
          falsifier: 'f',
          minimalExperiment: 'e',
          confidence: 0.5,
        },
      ],
      reviews: [],
      falsifications: [],
      calls: [],
      warnings: [],
    } as unknown as ResearchSession;
    councilStore.save(council);
    const started = await service.start({
      topic: 'Design the follow-up study',
      fromSessionId: council.id,
      interview: false,
    });
    expect(started.config.fromSessionId).toBe(council.id);
    expect(started.config.contextPaths).toEqual(['docs']);
    expect(started.config.markdownOnly).toBe(true);
    expect(started.priorFindings).toEqual([
      expect.objectContaining({ id: 'H-001', rank: 1, title: 'Clock drift reorders events' }),
    ]);
    await service.draft(started.id);
    const draftPrompt = gateway.prompts.find((call) =>
      call.prompt.startsWith('proposal-draft:v1')
    )!;
    expect(draftPrompt.prompt).toContain('PRIOR COUNCIL FINDINGS');
    expect(draftPrompt.prompt).toContain('H-001 (rank 1): Clock drift reorders events');
    expect(draftPrompt.prompt).not.toContain('authorProvider');
    await expect(
      new ResearchProposalService(
        gateway,
        new ProposalSessionStore(mkdtempSync(join(tmpdir(), 'x-')))
      ).preview({ topic: 't', fromSessionId: council.id })
    ).rejects.toThrow('Council sessions are not available');
  });
});
