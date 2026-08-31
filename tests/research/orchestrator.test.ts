import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { argumentTransportLimitBytes } from '../../src/research/context-budget.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { HypothesisCouncilService } from '../../src/research/orchestrator.js';
import { ResearchSessionStore } from '../../src/research/store.js';
import type {
  ProviderDescriptor,
  ResearchCompletion,
  ResearchCompletionOptions,
  ResearchProviderGateway,
} from '../../src/research/types.js';

class ScriptedGateway implements ResearchProviderGateway {
  readonly prompts: Array<{ provider: string; prompt: string; cwd: string }> = [];

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

  healthCheck(
    _provider: string,
    _workingDirectory: string,
    _signal?: AbortSignal
  ): Promise<boolean> {
    return Promise.resolve(true);
  }

  complete(
    provider: string,
    prompt: string,
    options: ResearchCompletionOptions
  ): Promise<ResearchCompletion> {
    this.prompts.push({ provider, prompt, cwd: options.workingDirectory });
    if (prompt.startsWith('hypothesis-generation:v3')) {
      if (provider === 'duck-a') return Promise.resolve({ content: 'not json', model: 'a-model' });
      return Promise.resolve({ content: generation('B'), model: 'b-model' });
    }
    if (prompt.startsWith('hypothesis-generation-repair:v3')) {
      return Promise.resolve({ content: generation('A'), model: 'a-model' });
    }
    if (prompt.startsWith('blind-review:v3')) {
      return Promise.resolve({ content: review(), model: `${provider}-model` });
    }
    if (prompt.startsWith('falsification:v3')) {
      return Promise.resolve({ content: falsification(), model: `${provider}-model` });
    }
    if (prompt.startsWith('session-grounded-ask:v3')) {
      return Promise.resolve({ content: 'A grounded answer.', model: `${provider}-model` });
    }
    throw new Error(`Unexpected prompt: ${prompt.slice(0, 80)}`);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

function generation(prefix: string): string {
  const topics =
    prefix === 'A'
      ? [
          ['Cache eviction ordering', 'Delayed eviction messages preserve stale records'],
          ['Temporal clock drift', 'Clock drift reverses event ordering across nodes'],
        ]
      : [
          ['Selection sampling bias', 'Biased sampling overrepresents successful observations'],
          ['Queue contention burst', 'Queue contention creates correlated latency bursts'],
        ];
  const evidence =
    prefix === 'A'
      ? [
          { claim: 'A remembered latency pattern', basis: 'general-knowledge' },
          {
            claim: 'A claim about the packet',
            basis: 'context',
            contextQuote: 'This text is nowhere in the shared packet.',
          },
        ]
      : [
          {
            claim: 'Failures cluster at open',
            basis: 'context',
            contextQuote: 'Observed failures cluster at open.',
          },
        ];
  return JSON.stringify({
    hypotheses: topics.map(([title, claim], index) => ({
      title,
      claim,
      mechanism: `${prefix} mechanism ${index + 1}`,
      predictions: [`${prefix} prediction ${index + 1}`],
      assumptions: [`${prefix} assumption ${index + 1}`],
      differsFromConsensus: `${prefix} consensus difference ${index + 1}`,
      evidence,
      falsifier: `${prefix} falsifier ${index + 1}`,
      minimalExperiment: `${prefix} experiment ${index + 1}`,
      confidence: 0.6,
    })),
  });
}

function review(): string {
  return JSON.stringify({
    plausibility: 7,
    novelty: 8,
    testability: 9,
    falsifiability: 8,
    feasibility: 7,
    robustness: 6,
    killCriterion: 'concrete',
    fatalFlaw: null,
    strongestObjection: 'A competing mechanism could explain the result.',
    hiddenAssumptions: ['Measurement is reliable'],
    proposedDiscriminatingTest: 'Randomize the suspected mechanism.',
    verdict: 'accept',
    confidence: 0.75,
  });
}

function falsification(): string {
  return JSON.stringify({
    damagingAssumption: 'The measurement is unbiased.',
    competingExplanation: 'Selection effects produce the pattern.',
    falsifyingObservation: 'The effect disappears under randomization.',
    discriminatingExperiment: 'Run a preregistered randomized test.',
    remainsUsefulIfMechanismFalse: 'The measurement protocol remains useful.',
  });
}

describe('HypothesisCouncilService', () => {
  it('runs the first vertical slice with independence, blinding, repair, and artifacts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hc-session-'));
    const gateway = new ScriptedGateway();
    const store = new ResearchSessionStore(root);
    const service = new HypothesisCouncilService(gateway, store);
    const repository = mkdtempSync(join(tmpdir(), 'hc-repository-'));
    writeFileSync(join(repository, 'README.md'), '# Evidence\nObserved failures cluster at open.');
    let previewFiles: string[] = [];

    const session = await service.run(
      {
        goal: 'Explain the observed failure mode',
        contextRoot: repository,
        contextPaths: ['.'],
        markdownOnly: true,
        hypothesesPerProvider: 2,
        topK: 1,
        seed: 7,
      },
      undefined,
      undefined,
      (preview) => {
        previewFiles = preview.contextManifest.files.map((file) => file.path);
        expect(preview.contextBudget.maxBytes).toBe(argumentTransportLimitBytes());
      }
    );

    expect(session.status).toBe('completed');
    expect(session.candidates).toHaveLength(4);
    expect(session.reviews).toHaveLength(4);
    expect(session.reviews.every((item) => !item.selfReview)).toBe(true);
    expect(session.falsifications).toHaveLength(1);
    expect(session.calls.some((call) => call.stage === 'generation-repair')).toBe(true);
    expect(session.reportMarkdownPath && existsSync(session.reportMarkdownPath)).toBe(true);
    const markdown = readFileSync(session.reportMarkdownPath!, 'utf8');
    expect(markdown).toContain('Hypothesis Council Report');
    expect(markdown).toContain('Differs from consensus:');
    expect(markdown).toContain('Evidence basis:');
    expect(readFileSync(session.reportJsonPath!, 'utf8')).not.toContain('authorProvider');

    const duckA = session.candidates.find((item) => item.authorProvider === 'duck-a');
    expect(duckA?.evidence?.map((entry) => entry.verification)).toEqual([
      'not-applicable',
      'unverified',
    ]);
    const duckB = session.candidates.find((item) => item.authorProvider === 'duck-b');
    expect(duckB?.evidence?.map((entry) => entry.verification)).toEqual(['verified']);
    expect(session.consensusCrowding).toBeDefined();
    expect(session.consensusCrowding?.clusters).toEqual([]);
    expect(session.reviews.every((item) => item.killCriterion === 'concrete')).toBe(true);
    expect(previewFiles).toEqual(['README.md']);
    expect(session.config).toMatchObject({
      contextRoot: repository,
      markdownOnly: true,
      maxContextBytes: argumentTransportLimitBytes(),
    });

    const generationPrompts = gateway.prompts.filter((item) =>
      item.prompt.startsWith('hypothesis-generation:v3')
    );
    expect(generationPrompts).toHaveLength(2);
    expect(generationPrompts[0].prompt).toBe(generationPrompts[1].prompt);
    for (const call of gateway.prompts.filter((item) =>
      item.prompt.startsWith('blind-review:v3')
    )) {
      expect(call.prompt).not.toContain('authorProvider');
      expect(call.cwd).toContain(session.id);
    }

    await expect(service.ask(session.id, 'What evidence matters most?')).resolves.toBe(
      'A grounded answer.'
    );
  });

  it('retries a blank generation reply once with the same sealed prompt', async () => {
    class BlankOnceGateway extends ScriptedGateway {
      private blankGenerations = 0;

      override complete(
        provider: string,
        prompt: string,
        options: ResearchCompletionOptions
      ): Promise<ResearchCompletion> {
        if (provider === 'duck-a' && prompt.startsWith('hypothesis-generation:v3')) {
          this.prompts.push({ provider, prompt, cwd: options.workingDirectory });
          this.blankGenerations++;
          return Promise.resolve(
            this.blankGenerations === 1
              ? { content: '\n', model: 'a-model' }
              : { content: generation('A'), model: 'a-model' }
          );
        }
        return super.complete(provider, prompt, options);
      }
    }
    const root = mkdtempSync(join(tmpdir(), 'hc-session-'));
    const gateway = new BlankOnceGateway();
    const service = new HypothesisCouncilService(gateway, new ResearchSessionStore(root));
    const repository = mkdtempSync(join(tmpdir(), 'hc-repository-'));
    writeFileSync(join(repository, 'README.md'), '# Evidence\nObserved failures cluster at open.');

    const session = await service.run({
      goal: 'Explain the observed failure mode',
      contextRoot: repository,
      contextPaths: ['.'],
      hypothesesPerProvider: 2,
      topK: 1,
      seed: 7,
    });

    expect(session.status).toBe('completed');
    expect(session.candidates).toHaveLength(4);
    expect(session.warnings).toContain('Empty generation response from duck-a; retried once');
    expect(session.calls.map((call) => call.id)).toEqual(
      expect.arrayContaining(['generation-duck-a', 'generation-retry-duck-a'])
    );
    expect(session.calls.some((call) => call.stage === 'generation-repair')).toBe(false);
    const generationPrompts = gateway.prompts.filter(
      (item) => item.provider === 'duck-a' && item.prompt.startsWith('hypothesis-generation:v3')
    );
    expect(generationPrompts).toHaveLength(2);
    expect(generationPrompts[0].prompt).toBe(generationPrompts[1].prompt);
  });
});

describe('HypothesisCouncilService previews and progress', () => {
  it('previews a run without creating a session or contacting a provider', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hc-preview-'));
    const gateway = new ScriptedGateway();
    const store = new ResearchSessionStore(root);
    const service = new HypothesisCouncilService(gateway, store);
    const repository = mkdtempSync(join(tmpdir(), 'hc-preview-repo-'));
    writeFileSync(join(repository, 'README.md'), '# Evidence');

    const preview = await service.preview({
      goal: 'Explain it',
      contextRoot: repository,
      contextPaths: ['.'],
      hypothesesPerProvider: 2,
      topK: 1,
    });

    expect(preview.providers).toEqual(['duck-a', 'duck-b']);
    expect(preview.minProviders).toBe(2);
    expect(preview.hypothesesPerProvider).toBe(2);
    expect(preview.plannedCalls).toEqual({ generation: 2, review: 4, falsification: 1, total: 7 });
    expect(preview.contextManifest.files.map((file) => file.path)).toEqual(['README.md']);
    expect(store.list()).toEqual([]);
    expect(gateway.prompts).toEqual([]);
  });

  it('emits started and finished progress events that never name reviewers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hc-progress-'));
    const store = new ResearchSessionStore(root);
    const service = new HypothesisCouncilService(new ScriptedGateway(), store);
    const repository = mkdtempSync(join(tmpdir(), 'hc-progress-repo-'));
    writeFileSync(join(repository, 'README.md'), '# Evidence');
    const events: Array<{ stage: string; event?: string; subject?: string }> = [];

    await service.run(
      {
        goal: 'Explain it',
        contextRoot: repository,
        contextPaths: ['.'],
        hypothesesPerProvider: 2,
        topK: 1,
      },
      (progress) => void events.push(progress)
    );

    expect(
      events
        .filter((event) => event.stage === 'preflight' && event.event === 'started')
        .map((event) => event.subject)
        .sort()
    ).toEqual(['duck-a', 'duck-b']);
    expect(events).toContainEqual(
      expect.objectContaining({ stage: 'generating', event: 'started', subject: 'duck-a' })
    );
    expect(events).toContainEqual(
      expect.objectContaining({ stage: 'generating', event: 'finished', subject: 'duck-b' })
    );
    const reviewSubjects = events
      .filter((event) => ['reviewing', 'falsifying'].includes(event.stage) && event.subject)
      .map((event) => event.subject as string);
    expect(reviewSubjects.length).toBeGreaterThan(0);
    expect(reviewSubjects.every((subject) => /^H-\d{3}$/.test(subject))).toBe(true);
    expect(events.at(-1)).toMatchObject({ stage: 'completed', completed: 1, total: 1 });
  });
});
