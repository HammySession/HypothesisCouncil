import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
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
    if (prompt.startsWith('hypothesis-generation:v1')) {
      if (provider === 'duck-a') return Promise.resolve({ content: 'not json', model: 'a-model' });
      return Promise.resolve({ content: generation('B'), model: 'b-model' });
    }
    if (prompt.startsWith('hypothesis-generation-repair:v1')) {
      return Promise.resolve({ content: generation('A'), model: 'a-model' });
    }
    if (prompt.startsWith('blind-review:v1')) {
      return Promise.resolve({ content: review(), model: `${provider}-model` });
    }
    if (prompt.startsWith('falsification:v1')) {
      return Promise.resolve({ content: falsification(), model: `${provider}-model` });
    }
    if (prompt.startsWith('session-grounded-ask:v1')) {
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
  return JSON.stringify({
    hypotheses: topics.map(([title, claim], index) => ({
      title,
      claim,
      mechanism: `${prefix} mechanism ${index + 1}`,
      predictions: [`${prefix} prediction ${index + 1}`],
      assumptions: [`${prefix} assumption ${index + 1}`],
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
        expect(preview.contextBudget.maxBytes).toBe(96 * 1024);
      }
    );

    expect(session.status).toBe('completed');
    expect(session.candidates).toHaveLength(4);
    expect(session.reviews).toHaveLength(4);
    expect(session.reviews.every((item) => !item.selfReview)).toBe(true);
    expect(session.falsifications).toHaveLength(1);
    expect(session.calls.some((call) => call.stage === 'generation-repair')).toBe(true);
    expect(session.reportMarkdownPath && existsSync(session.reportMarkdownPath)).toBe(true);
    expect(readFileSync(session.reportMarkdownPath!, 'utf8')).toContain(
      'Hypothesis Council Report'
    );
    expect(readFileSync(session.reportJsonPath!, 'utf8')).not.toContain('authorProvider');
    expect(previewFiles).toEqual(['README.md']);
    expect(session.config).toMatchObject({
      contextRoot: repository,
      markdownOnly: true,
      maxContextBytes: 96 * 1024,
    });

    const generationPrompts = gateway.prompts.filter((item) =>
      item.prompt.startsWith('hypothesis-generation:v1')
    );
    expect(generationPrompts).toHaveLength(2);
    expect(generationPrompts[0].prompt).toBe(generationPrompts[1].prompt);
    for (const call of gateway.prompts.filter((item) =>
      item.prompt.startsWith('blind-review:v1')
    )) {
      expect(call.prompt).not.toContain('authorProvider');
      expect(call.cwd).toContain(session.id);
    }

    await expect(service.ask(session.id, 'What evidence matters most?')).resolves.toBe(
      'A grounded answer.'
    );
  });
});
