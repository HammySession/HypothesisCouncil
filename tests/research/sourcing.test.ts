import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DEFAULT_DIAL_POLICY } from '../../src/research/dials.js';
import {
  HypothesisCouncilService,
  planProviderCalls,
  planSourcingCalls,
} from '../../src/research/orchestrator.js';
import type { SourceVerifier } from '../../src/research/source-verify.js';
import { SOURCES_SECTION_BEGIN, type SourceRecord } from '../../src/research/sources.js';
import { ResearchSessionStore } from '../../src/research/store.js';
import type {
  ProviderDescriptor,
  ResearchCompletion,
  ResearchCompletionOptions,
  ResearchProviderGateway,
} from '../../src/research/types.js';

const SCOUT = 'duck-c_scout';

class SourcingGateway implements ResearchProviderGateway {
  readonly prompts: Array<{ provider: string; prompt: string }> = [];

  listProviders(): Promise<ProviderDescriptor[]> {
    return Promise.resolve(
      ['duck-a', 'duck-b', SCOUT].map((name) => ({
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
    _options: ResearchCompletionOptions
  ): Promise<ResearchCompletion> {
    this.prompts.push({ provider, prompt });
    const model = `${provider}-model`;
    if (prompt.startsWith('source-scout:v1')) {
      if (provider !== SCOUT) throw new Error(`Council member ${provider} was asked to scout`);
      return Promise.resolve({ content: scoutReply(), model });
    }
    if (prompt.startsWith('source-critique:v1')) {
      if (provider === SCOUT) throw new Error('A scout was asked to grade sources');
      return Promise.resolve({ content: critiqueReply(), model });
    }
    if (provider === SCOUT)
      throw new Error(`Scout received a council prompt: ${prompt.slice(0, 40)}`);
    if (prompt.startsWith('hypothesis-generation:v4')) {
      return Promise.resolve({ content: generation(provider), model });
    }
    if (prompt.startsWith('blind-review:v4')) {
      return Promise.resolve({ content: review(), model });
    }
    if (prompt.startsWith('falsification:v4')) {
      return Promise.resolve({ content: falsification(), model });
    }
    throw new Error(`Unexpected prompt: ${prompt.slice(0, 80)}`);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

function scoutReply(): string {
  return JSON.stringify({
    sources: [
      {
        title: 'Scouted good',
        url: 'https://example.org/scouted-good',
        year: 2024,
        venue: 'NSDI',
        kind: 'paper',
        summary: 'Reports open-time bursts.',
      },
      { title: 'Scouted dead', url: 'https://example.org/scouted-dead' },
      { title: 'No link at all' },
      { title: 'Retracted result', doi: '10.1000/retracted' },
      { title: 'User paper again', url: 'https://example.org/user-paper?utm_source=scout' },
    ],
  });
}

function critiqueReply(): string {
  return JSON.stringify({
    assessments: [
      { id: 'S-001', reliability: 9, replication: 'replicated', concerns: [] },
      {
        id: 's-003',
        kind: 'preprint',
        reliability: 2,
        replication: 'contested',
        concerns: [' n=3 '],
      },
      { id: 'S-999', reliability: 5, replication: 'unknown', concerns: [] },
    ],
  });
}

function generation(provider: string): string {
  const prefix = provider === 'duck-a' ? 'A' : 'B';
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
          { claim: 'Replicated open-time effect', basis: 'source', sourceId: 'S-001' },
          {
            claim: 'Failures cluster at open',
            basis: 'context',
            contextQuote: 'Observed failures cluster at open.',
          },
        ]
      : [
          { claim: 'A shaky preprint agrees', basis: 'source', sourceId: 's-3' },
          { claim: 'A dropped record', basis: 'source', sourceId: 'S-004' },
          {
            claim: 'Quoting the appendix',
            basis: 'context',
            contextQuote: 'Reports open-time bursts.',
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

class FakeVerifier implements SourceVerifier {
  readonly modes: string[] = [];

  verify(sources: SourceRecord[], options: { mode: string }): Promise<SourceRecord[]> {
    this.modes.push(options.mode);
    return Promise.resolve(
      sources.map((record) => {
        const checkedAt = '2026-09-04T00:00:00.000Z';
        if (record.doi === '10.1000/retracted') {
          return {
            ...record,
            verification: {
              status: 'retracted' as const,
              checkedAt,
              retraction: { checked: true, notice: 'Retraction' },
            },
          };
        }
        if (record.url?.endsWith('dead')) {
          return {
            ...record,
            verification: { status: 'unreachable' as const, checkedAt, error: 'HTTP 404' },
          };
        }
        return {
          ...record,
          verification: { status: 'reachable' as const, checkedAt, httpStatus: 200 },
        };
      })
    );
  }
}

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'hc-sourcing-repo-'));
  writeFileSync(join(root, 'README.md'), '# Evidence\nObserved failures cluster at open.\n');
  writeFileSync(
    join(root, 'sources.md'),
    [
      '- [User paper](https://example.org/user-paper) 2021',
      '- User dead https://example.org/user-dead',
      '',
    ].join('\n')
  );
  return root;
}

describe('sources stage', () => {
  it('collects user and scouted sources, verifies them, grades them, and seals them into the packet', async () => {
    const gateway = new SourcingGateway();
    const verifier = new FakeVerifier();
    const store = new ResearchSessionStore(mkdtempSync(join(tmpdir(), 'hc-sourcing-')));
    const service = new HypothesisCouncilService(gateway, store, { sourceVerifier: verifier });
    const root = repository();
    let previewed: Parameters<Parameters<typeof service.run>[3] & object>[0] | undefined;

    const session = await service.run(
      {
        goal: 'Explain the open-time failure bursts',
        contextRoot: root,
        contextPaths: ['README.md'],
        sourcesFile: 'sources.md',
        hypothesesPerProvider: 2,
        topK: 1,
        seed: 7,
      },
      undefined,
      undefined,
      (preview) => {
        previewed = preview;
      }
    );

    expect(previewed?.sourcesPlan).toMatchObject({
      sourcesFile: 'sources.md',
      userSources: 2,
      scouts: [SCOUT],
      web: 'on',
      rounds: 1,
      sourcesPerScout: 5,
      verification: 'fetch',
      critique: true,
    });
    expect(previewed?.sourcesPlan?.reservedBytes).toBeGreaterThan(0);
    expect(previewed?.plannedCalls.sourcing).toBe(2);
    expect(previewed?.contextManifest.reservedBytes).toBe(previewed?.sourcesPlan?.reservedBytes);

    expect(session.status).toBe('completed');
    expect(session.providers).toEqual(['duck-a', 'duck-b']);
    expect(session.config.sources).toMatchObject({
      scouts: [SCOUT],
      web: 'on',
      verification: 'fetch',
    });
    expect(verifier.modes).toEqual(['fetch']);
    expect(session.sourcesCompletedAt).toBeDefined();
    expect(
      session.sources?.map((record) => [record.id, record.origin, record.verification?.status])
    ).toEqual([
      ['S-001', 'user', 'reachable'],
      ['S-002', 'user', 'unreachable'],
      ['S-003', 'scout', 'reachable'],
    ]);
    expect(session.sources?.[2]).toMatchObject({
      title: 'Scouted good',
      url: 'https://example.org/scouted-good',
      kind: 'preprint',
      scoutProvider: SCOUT,
      critique: { reliability: 2, replication: 'contested', concerns: ['n=3'] },
    });
    expect(session.sources?.[0].critique).toEqual({
      reliability: 9,
      replication: 'replicated',
      concerns: [],
    });
    expect(session.warnings).toEqual(
      expect.arrayContaining([
        `${SCOUT} proposed 1 source without a URL or DOI; discarded`,
        expect.stringContaining(
          'Dropped 2 source record(s): S-004 (Scouted dead) could not be fetched: HTTP 404; S-005 (Retracted result) is retracted'
        ),
      ])
    );

    const stages = session.calls.map((call) => call.stage);
    expect(stages.filter((stage) => stage === 'source-scout')).toHaveLength(1);
    expect(stages.filter((stage) => stage === 'source-critique')).toHaveLength(1);
    expect(session.calls.find((call) => call.stage === 'source-scout')).toMatchObject({
      id: `source-scout-${SCOUT}`,
      provider: SCOUT,
    });
    const critique = session.calls.find((call) => call.stage === 'source-critique');
    expect(['duck-a', 'duck-b']).toContain(critique?.provider);

    const scoutPrompt = gateway.prompts.find((item) => item.prompt.startsWith('source-scout:v1'));
    expect(scoutPrompt?.provider).toBe(SCOUT);
    expect(scoutPrompt?.prompt).toContain('Find exactly 5 primary sources');
    expect(scoutPrompt?.prompt).toContain('- https://example.org/user-paper');
    expect(scoutPrompt?.prompt).toContain('README.md');
    expect(scoutPrompt?.prompt).not.toContain('Observed failures cluster at open.');
    const critiquePrompt = gateway.prompts.find((item) =>
      item.prompt.startsWith('source-critique:v1')
    );
    expect(critiquePrompt?.prompt).toContain('"id": "S-003"');
    expect(critiquePrompt?.prompt).toContain('"verification": "reachable"');
    expect(critiquePrompt?.prompt).not.toContain(SCOUT);

    const generationPrompts = gateway.prompts.filter((item) =>
      item.prompt.startsWith('hypothesis-generation:v4')
    );
    expect(generationPrompts).toHaveLength(2);
    expect(generationPrompts[0].prompt).toBe(generationPrompts[1].prompt);
    expect(generationPrompts[0].prompt).toContain(SOURCES_SECTION_BEGIN);
    expect(generationPrompts[0].prompt).toContain(
      'S-001 | other | user-supplied | reachable | User paper (2021)'
    );
    expect(generationPrompts[0].prompt).toContain(
      'S-003 | preprint | scouted | reachable | Scouted good (2024, NSDI)'
    );
    expect(generationPrompts[0].prompt).toContain(
      'reliability 2/10, replication contested; concerns: n=3'
    );
    expect(generationPrompts[0].prompt).not.toContain(SCOUT);
    expect(generationPrompts[0].prompt).not.toContain('S-004');

    const packet = store.readContextPacket(session.id);
    expect(packet).toContain('Observed failures cluster at open.');
    expect(packet).toContain(SOURCES_SECTION_BEGIN);
    expect(session.contextManifest.appendixBytes).toBeGreaterThan(0);
    expect(session.contextManifest.packetBytes).toBe(Buffer.byteLength(packet));
    expect(existsSync(store.artifactPath(session.id, 'sources.json'))).toBe(true);
    expect(existsSync(store.artifactPath(session.id, 'sources-section.txt'))).toBe(true);
    expect(
      JSON.parse(readFileSync(store.artifactPath(session.id, 'sources.json'), 'utf8'))
    ).toHaveLength(3);

    const byAuthor = (author: string) =>
      session.candidates.find((candidate) => candidate.authorProvider === author)?.evidence ?? [];
    expect(
      byAuthor('duck-a').map((entry) => [entry.sourceId, entry.verification, entry.reliability])
    ).toEqual([
      ['S-001', 'verified', 9],
      [undefined, 'verified', undefined],
    ]);
    expect(
      byAuthor('duck-b').map((entry) => [entry.sourceId, entry.verification, entry.replication])
    ).toEqual([
      ['S-003', 'verified', 'contested'],
      ['S-004', 'unverified', undefined],
      [undefined, 'unverified', undefined],
    ]);

    const markdown = readFileSync(session.reportMarkdownPath!, 'utf8');
    expect(markdown).toContain('## Sources');
    expect(markdown).toContain('| S-001 |');
    expect(markdown).toContain('| S-003 |');
    expect(markdown).toContain('Sources: 3 records (2 reachable); verification fetch');
    // Scout names are public configuration; which scout proposed which record is not.
    const sourcesSection = markdown.slice(
      markdown.indexOf('## Sources'),
      markdown.indexOf('## Council')
    );
    expect(sourcesSection).toContain('| S-003 |');
    expect(sourcesSection).not.toContain(SCOUT);
    const reportJson = readFileSync(session.reportJsonPath!, 'utf8');
    expect(reportJson).toContain('"S-003"');
    expect(reportJson).not.toContain('scoutProvider');
    const publicSources = (JSON.parse(reportJson) as { sources?: Array<Record<string, unknown>> })
      .sources;
    expect(publicSources?.map((record) => record.id)).toEqual(['S-001', 'S-002', 'S-003']);
    expect(publicSources?.some((record) => JSON.stringify(record).includes(SCOUT))).toBe(false);
  });

  it('keeps scouts off the council and rejects unknown scouts and empty sources files', async () => {
    const gateway = new SourcingGateway();
    const store = new ResearchSessionStore(mkdtempSync(join(tmpdir(), 'hc-sourcing-')));
    const service = new HypothesisCouncilService(gateway, store, {
      sourceVerifier: new FakeVerifier(),
    });
    const root = repository();
    writeFileSync(join(root, 'empty.md'), '# Nothing here\n');

    await expect(
      service.run({
        goal: 'Goal',
        contextRoot: root,
        contextPaths: ['README.md'],
        providers: ['duck-a', SCOUT],
      })
    ).rejects.toThrow(`Scout providers cannot sit on the council (they have web access): ${SCOUT}`);
    await expect(
      service.run({
        goal: 'Goal',
        contextRoot: root,
        contextPaths: ['README.md'],
        scouts: ['nope'],
      })
    ).rejects.toThrow('Unknown scout provider: nope');
    await expect(
      service.run({
        goal: 'Goal',
        contextRoot: root,
        contextPaths: ['README.md'],
        sourcesFile: 'empty.md',
      })
    ).rejects.toThrow('Sources file contains no source records: empty.md');
    await expect(
      service.run({
        goal: 'Goal',
        contextRoot: root,
        contextPaths: ['README.md'],
        sourcesFile: 'missing.md',
      })
    ).rejects.toThrow('Sources file not found');
    expect(gateway.prompts).toEqual([]);
  });

  it('runs without scouting or fetching when the web is off, and without a sources stage when nothing is supplied', async () => {
    const gateway = new SourcingGateway();
    const verifier = new FakeVerifier();
    const store = new ResearchSessionStore(mkdtempSync(join(tmpdir(), 'hc-sourcing-')));
    const service = new HypothesisCouncilService(gateway, store, { sourceVerifier: verifier });
    const root = repository();

    const offline = await service.run({
      goal: 'Explain the open-time failure bursts',
      contextRoot: root,
      contextPaths: ['README.md'],
      sourcesFile: 'sources.md',
      web: 'off',
      hypothesesPerProvider: 2,
      topK: 1,
      seed: 7,
    });
    expect(offline.status).toBe('completed');
    expect(offline.config.sources).toMatchObject({
      scouts: [],
      web: 'off',
      verification: 'none',
      rounds: 0,
    });
    expect(verifier.modes).toEqual([]);
    expect(offline.sources?.map((record) => record.verification?.status)).toEqual([
      'skipped',
      'skipped',
    ]);
    expect(offline.calls.some((call) => call.stage === 'source-scout')).toBe(false);
    expect(offline.calls.some((call) => call.stage === 'source-critique')).toBe(true);
    expect(gateway.prompts.some((item) => item.provider === SCOUT)).toBe(false);
    const evidence = offline.candidates.find(
      (candidate) => candidate.authorProvider === 'duck-a'
    )?.evidence;
    expect(evidence?.[0]).toMatchObject({ sourceId: 'S-001', verification: 'unverified' });

    const plain = await service.run({
      goal: 'Explain the open-time failure bursts',
      contextRoot: root,
      contextPaths: ['README.md'],
      web: 'off',
      hypothesesPerProvider: 2,
      topK: 1,
      seed: 7,
    });
    expect(plain.config.sources).toBeUndefined();
    expect(plain.sources).toBeUndefined();
    expect(store.readContextPacket(plain.id)).not.toContain(SOURCES_SECTION_BEGIN);
  });

  it('counts sourcing calls in the plan', () => {
    expect(planSourcingCalls(undefined)).toBe(0);
    const base = {
      userSources: 2,
      scouts: ['a', 'b'],
      web: 'on' as const,
      rounds: 2,
      sourcesPerScout: 5,
      verification: 'fetch' as const,
      critique: true,
      reservedBytes: 100,
    };
    expect(planSourcingCalls(base)).toBe(4 + Math.ceil(22 / 20));
    expect(planSourcingCalls({ ...base, critique: false })).toBe(4);
    expect(planSourcingCalls({ ...base, scouts: [], rounds: 0, userSources: 0 })).toBe(0);
    const planned = planProviderCalls(2, 2, 1, DEFAULT_DIAL_POLICY, 3);
    expect(planned.sourcing).toBe(3);
    expect(planned.total).toBe(planProviderCalls(2, 2, 1).total + 3);
    expect(planProviderCalls(2, 2, 1).sourcing).toBeUndefined();
  });
});
