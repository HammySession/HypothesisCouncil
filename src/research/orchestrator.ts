import { resolve } from 'path';
import { buildContextPacket, withAppendix, type BuiltContext } from './context.js';
import { calculateContextBudget } from './context-budget.js';
import { deduplicateCandidates, measureConsensusCrowding } from './dedup.js';
import { verifyEvidence } from './evidence.js';
import { assignReviewers, stableHash } from './assignment.js';
import {
  CouncilCalls,
  emitProgress,
  preflightProviders,
  throwIfAborted,
  type CallSpec,
} from './calls.js';
import { DEFAULT_DIAL_POLICY, resolveDialPolicy, type DialPolicy } from './dials.js';
import {
  FalsificationOutputSchema,
  GenerationOutputSchema,
  ReviewOutputSchema,
  SourceCritiqueOutputSchema,
  SourceScoutOutputSchema,
  type GenerationOutput,
  type SourceScoutOutput,
} from './schemas.js';
import {
  PROMPT_VERSIONS,
  buildFalsificationPrompt,
  buildFalsificationRepairPrompt,
  buildGenerationPrompt,
  buildGenerationRepairPrompt,
  buildReviewPrompt,
  buildReviewRepairPrompt,
  buildSessionAskPrompt,
  buildSourceCritiquePrompt,
  buildSourceCritiqueRepairPrompt,
  buildSourceScoutPrompt,
  buildSourceScoutRepairPrompt,
  type GenerationVariant,
} from './prompts.js';
import { rankCandidates } from './ranking.js';
import { createPublicReport, renderMarkdownReport } from './report.js';
import { DEFAULT_DIALS, dialConfigFrom } from './settings.js';
import {
  createFetchSourceVerifier,
  skippedVerifier,
  type SourceVerifier,
} from './source-verify.js';
import {
  isScoutProvider,
  normalizeSources,
  parseSourcesFile,
  renderSourcesSection,
  sourcePriority,
  splitAppendix,
  type SourceInput,
  type SourceRecord,
} from './sources.js';
import { ResearchSessionStore } from './store.js';
import type {
  HypothesisCandidate,
  HypothesisFalsification,
  HypothesisReview,
  PlannedProviderCalls,
  ResearchCompletion,
  ResearchProgressHandler,
  ResearchProviderGateway,
  ResearchRunApproval,
  ResearchRunPreview,
  ResearchSession,
  RunResearchInput,
  SourcesConfig,
  SourcesPlan,
} from './types.js';

const DEFAULT_HYPOTHESES_PER_PROVIDER = 3;
const DEFAULT_TOP_K = 3;
/** Records per source-critique call; larger batches make the grading sloppy. */
const CRITIQUE_BATCH_SIZE = 20;
/** Rough packet bytes one rendered source record occupies, for reserving appendix room. */
const ESTIMATED_SOURCE_BYTES = 420;
const SOURCES_SECTION_OVERHEAD_BYTES = 480;
/** Never hold back more than a quarter of the shared budget for sources. */
const MAX_APPENDIX_SHARE = 0.25;

export interface HypothesisCouncilOptions {
  /** Fetches cited URLs during the sources stage; defaults to a real fetch-based verifier. */
  sourceVerifier?: SourceVerifier;
}

/** Scout calls plus critique batches a sources plan will make; 0 when there is no plan. */
export function planSourcingCalls(plan: SourcesPlan | undefined): number {
  if (!plan) return 0;
  const scouting = plan.scouts.length * plan.rounds;
  const expected = plan.userSources + scouting * plan.sourcesPerScout;
  const critique = plan.critique && expected > 0 ? Math.ceil(expected / CRITIQUE_BATCH_SIZE) : 0;
  return scouting + critique;
}

/**
 * Upper bound on model calls for a run before repairs and blank-reply retries: one generation per
 * provider (plus one out-of-the-box generation per provider at high novelty), one review per raw
 * candidate (deduplication can only lower this), and one falsification per finalist per round.
 */
export function planProviderCalls(
  providerCount: number,
  hypothesesPerProvider: number,
  topK: number,
  policy: DialPolicy = DEFAULT_DIAL_POLICY,
  sourcing = 0
): PlannedProviderCalls {
  const generation = providerCount;
  const outOfBox = providerCount * policy.outOfBoxCalls;
  const review = providerCount * hypothesesPerProvider + outOfBox * policy.outOfBoxHypotheses;
  const falsificationRounds = Math.max(1, policy.falsificationRounds);
  const falsification = Math.min(topK, review) * falsificationRounds;
  const planned: PlannedProviderCalls = {
    generation,
    outOfBox,
    review,
    falsification,
    falsificationRounds,
    total: sourcing + generation + outOfBox + review + falsification,
  };
  if (sourcing > 0) planned.sourcing = sourcing;
  return planned;
}

/** Whether a session still has to run (or re-run) its sources stage before generating. */
export function needsSourcing(session: ResearchSession): boolean {
  const config = session.config.sources;
  if (!config || session.sourcesCompletedAt) return false;
  return (session.sources?.length ?? 0) > 0 || config.scouts.length > 0;
}

/** The policy a persisted session runs under; pre-dial sessions use the default policy. */
export function sessionPolicy(session: ResearchSession): DialPolicy {
  return (
    session.config.policy ??
    resolveDialPolicy(session.config.dials ?? DEFAULT_DIALS, session.config.hypothesesPerProvider)
  );
}

interface GenerationTask {
  provider: string;
  variant: GenerationVariant;
  count: number;
  spec: CallSpec;
}

type GenerationResult =
  | { task: GenerationTask; completion: ResearchCompletion; callId: string }
  | { task: GenerationTask; error: unknown };

export class HypothesisCouncilService {
  private readonly calls: CouncilCalls<ResearchSession>;
  private readonly sourceVerifier: SourceVerifier;

  constructor(
    private readonly gateway: ResearchProviderGateway,
    readonly store: ResearchSessionStore,
    options: HypothesisCouncilOptions = {}
  ) {
    this.calls = new CouncilCalls(gateway, store);
    this.sourceVerifier = options.sourceVerifier ?? createFetchSourceVerifier();
  }

  /**
   * Resolve providers, size the shared context, and build the packet without creating a session.
   * This is what `hc run --dry-run` shows; it sends nothing to a model provider.
   */
  async preview(input: RunResearchInput, signal?: AbortSignal): Promise<ResearchRunPreview> {
    const prepared = await this.prepare(input, this.store.sessionDirectory('preview'), signal);
    return prepared.preview;
  }

  async run(
    input: RunResearchInput,
    progress?: ResearchProgressHandler,
    signal?: AbortSignal,
    approve?: ResearchRunApproval
  ): Promise<ResearchSession> {
    const sessionId = this.store.createId();
    const workingDirectory = this.store.sessionDirectory(sessionId);
    const { preview, context, sources } = await this.prepare(input, workingDirectory, signal);
    await approve?.(preview);
    const now = new Date().toISOString();
    const session: ResearchSession = {
      version: 1,
      id: sessionId,
      goal: preview.goal,
      meta: input.meta,
      status: 'running',
      stage: 'created',
      createdAt: now,
      updatedAt: now,
      config: {
        providers: preview.providers,
        hypothesesPerProvider: preview.hypothesesPerProvider,
        topK: preview.topK,
        minProviders: preview.minProviders,
        seed: input.seed ?? 42,
        maxContextBytes: preview.contextBudget.maxBytes,
        contextPaths: input.contextPaths || [],
        contextRoot: preview.contextRoot,
        markdownOnly: preview.markdownOnly,
        contextBudget: preview.contextBudget,
        dials: preview.dials,
        policy: preview.policy,
        sources: sources?.config,
      },
      providers: [],
      unavailableProviders: [],
      contextManifest: context.manifest,
      sources: sources?.records,
      candidates: [],
      reviews: [],
      falsifications: [],
      calls: [],
      warnings: [],
    };
    if (preview.providers.length === 1) {
      session.warnings.push(
        'Single-provider mode: reviews cannot provide independent authorship separation.'
      );
    }
    const assumedLimits = preview.contextBudget.providerLimits
      .filter((limit) => limit.source === 'provider-default')
      .map((limit) => limit.provider);
    if (assumedLimits.length > 0) {
      session.warnings.push(
        `Context limits use conservative provider defaults for: ${assumedLimits.join(', ')}. Configure per-provider token overrides when needed.`
      );
    }
    const transportLimits = preview.contextBudget.providerLimits
      .filter((limit) => limit.transportLimited)
      .map((limit) => limit.provider);
    if (transportLimits.length > 0) {
      session.warnings.push(
        `Context is capped by command-argument transport for: ${transportLimits.join(', ')}.`
      );
    }
    const unmatched = context.manifest.unmatchedRequestedPaths ?? [];
    if (unmatched.length > 0) {
      session.warnings.push(
        `Requested context matched no eligible files (missing, denied, or unsupported type): ${unmatched.join(', ')}.`
      );
    }
    this.store.save(session);
    this.store.writeContextPacket(session.id, context.packet);
    this.store.writeReport(
      session.id,
      'context-manifest.json',
      JSON.stringify(context.manifest, null, 2)
    );
    return this.execute(session, context.packet, progress, signal);
  }

  private async prepare(
    input: RunResearchInput,
    workingDirectory: string,
    signal?: AbortSignal
  ): Promise<{
    preview: ResearchRunPreview;
    context: BuiltContext;
    sources?: { config: SourcesConfig; records: SourceRecord[] };
  }> {
    const goal = input.goal.trim();
    if (!goal) throw new Error('A research goal is required');
    const descriptors = await this.gateway.listProviders(workingDirectory, signal);
    const known = new Set(descriptors.map((provider) => provider.name));
    // Scouts are the providers allowed on the web. They propose sources and never sit on the
    // council, so a scouted record can only reach a generator through the sealed packet.
    const web = input.web ?? 'on';
    const scouts =
      web === 'off'
        ? []
        : [
            ...new Set(
              input.scouts ??
                descriptors.filter((provider) => isScoutProvider(provider.name)).map((p) => p.name)
            ),
          ].sort();
    for (const scout of scouts) {
      if (!known.has(scout)) throw new Error(`Unknown scout provider: ${scout}`);
    }
    const scoutSet = new Set(scouts);
    // A provider named `*_scout` is web-enabled by convention, so it stays off the council even
    // when it is not scouting this run (for example with --web off).
    const isScout = (name: string) => scoutSet.has(name) || isScoutProvider(name);
    const defaultProviders = descriptors.filter(
      (provider) => provider.type === 'cli' && !isScout(provider.name)
    );
    const providers = [
      ...new Set(
        input.providers?.length
          ? input.providers
          : (defaultProviders.length > 0
              ? defaultProviders
              : descriptors.filter((provider) => !isScout(provider.name))
            ).map((provider) => provider.name)
      ),
    ].sort();
    if (providers.length === 0) throw new Error('No Rubber Duck providers are configured');
    const councilScouts = providers.filter(isScout);
    if (councilScouts.length > 0) {
      throw new Error(
        `Scout providers cannot sit on the council (they have web access): ${councilScouts.join(', ')}`
      );
    }

    const minProviders = input.minProviders ?? Math.min(2, providers.length);
    const hypothesesPerProvider = input.hypothesesPerProvider || DEFAULT_HYPOTHESES_PER_PROVIDER;
    const topK = input.topK || DEFAULT_TOP_K;
    const dials = dialConfigFrom(input.dials);
    const policy = resolveDialPolicy(dials, hypothesesPerProvider);
    const contextBudget = calculateContextBudget(descriptors, providers, input.maxContextBytes);
    const contextRoot = input.contextRoot || process.cwd();

    const userInputs: SourceInput[] = input.sourcesFile
      ? parseSourcesFile(resolve(contextRoot, input.sourcesFile))
      : [];
    if (input.sourcesFile && userInputs.length === 0) {
      throw new Error(`Sources file contains no source records: ${input.sourcesFile}`);
    }
    const userSources = normalizeSources([], userInputs, 'user').sources;
    let sources: { config: SourcesConfig; records: SourceRecord[] } | undefined;
    let sourcesPlan: SourcesPlan | undefined;
    let reserveBytes = 0;
    if (userSources.length > 0 || scouts.length > 0) {
      const config: SourcesConfig = {
        sourcesFile: input.sourcesFile,
        scouts,
        web,
        verification: web === 'off' ? 'none' : policy.sourceVerification,
        sourcesPerScout: policy.sourcesPerScout,
        rounds: scouts.length > 0 ? policy.sourceRounds : 0,
        critique: policy.sourceCritique,
      };
      const expected = userSources.length + scouts.length * config.rounds * config.sourcesPerScout;
      reserveBytes = Math.min(
        Math.floor(contextBudget.maxBytes * MAX_APPENDIX_SHARE),
        SOURCES_SECTION_OVERHEAD_BYTES + expected * ESTIMATED_SOURCE_BYTES
      );
      sources = { config, records: userSources };
      sourcesPlan = {
        sourcesFile: input.sourcesFile,
        userSources: userSources.length,
        scouts,
        web,
        rounds: config.rounds,
        sourcesPerScout: config.sourcesPerScout,
        verification: config.verification,
        critique: config.critique,
        reservedBytes: reserveBytes,
      };
    }

    const context = buildContextPacket(
      input.contextPaths || [],
      contextBudget.maxBytes,
      contextRoot,
      { markdownOnly: input.markdownOnly, reserveBytes }
    );
    const preview: ResearchRunPreview = {
      goal,
      providers,
      minProviders,
      hypothesesPerProvider,
      topK,
      plannedCalls: planProviderCalls(
        providers.length,
        hypothesesPerProvider,
        topK,
        policy,
        planSourcingCalls(sourcesPlan)
      ),
      contextManifest: context.manifest,
      contextBudget,
      contextRoot,
      markdownOnly: input.markdownOnly === true,
      dials,
      policy,
    };
    if (sourcesPlan) preview.sourcesPlan = sourcesPlan;
    return { context, preview, sources };
  }

  async resume(
    sessionId?: string,
    progress?: ResearchProgressHandler,
    signal?: AbortSignal
  ): Promise<ResearchSession> {
    const session = this.store.load(sessionId);
    if (session.status === 'completed') return session;
    session.status = 'running';
    session.error = undefined;
    this.store.save(session);
    return this.execute(session, this.store.readContextPacket(session.id), progress, signal);
  }

  async ask(
    sessionId: string | undefined,
    question: string,
    provider?: string,
    priorTurns: string[] = [],
    signal?: AbortSignal,
    extraContext?: string
  ): Promise<string> {
    const session = this.store.load(sessionId);
    if (session.candidates.length === 0) {
      throw new Error('Candidates remain sealed until independent generation completes');
    }
    const selectedProvider = provider || session.providers[0];
    if (!selectedProvider || !session.providers.includes(selectedProvider)) {
      throw new Error(
        `Provider is not part of session ${session.id}: ${selectedProvider || 'none'}`
      );
    }
    const completion = await this.calls.invokeDetached(
      session.id,
      {
        id: `ask-${selectedProvider}-${Date.now()}`,
        stage: 'ask',
        provider: selectedProvider,
        subject: session.id,
        promptVersion: PROMPT_VERSIONS.ask,
        prompt: buildSessionAskPrompt(session, question, priorTurns, extraContext),
      },
      signal
    );
    return completion.content;
  }

  private async execute(
    session: ResearchSession,
    contextPacket: string,
    progress?: ResearchProgressHandler,
    signal?: AbortSignal
  ): Promise<ResearchSession> {
    const policy = sessionPolicy(session);
    try {
      throwIfAborted(signal);
      await this.preflight(session, progress, signal);
      if (session.candidates.length === 0) {
        if (needsSourcing(session)) {
          throwIfAborted(signal);
          contextPacket = await this.source(session, contextPacket, policy, progress, signal);
        }
        throwIfAborted(signal);
        await this.generate(session, contextPacket, policy, progress, signal);
        session.stage = 'deduplicating';
        await emitProgress(progress, session.stage, 0, 1, 'Clustering lexical duplicates');
        session.candidates = deduplicateCandidates(session.candidates);
        session.consensusCrowding = measureConsensusCrowding(
          session.candidates,
          policy.crowdingThreshold
        );
        if (session.consensusCrowding.crowdingRatio >= 0.5) {
          const crowding = session.consensusCrowding;
          session.warnings.push(
            `Consensus crowding: ${crowding.crowdedCandidateIds.length} of ${session.candidates.length} independently generated hypotheses converged across providers (similarity >= ${crowding.similarityThreshold}). Agreement between models trained on the same literature is consensus recall, not independent replication.`
          );
        }
        this.store.save(session);
        await emitProgress(
          progress,
          session.stage,
          1,
          1,
          `${session.candidates.filter((candidate) => candidate.status === 'distinct').length} distinct candidates`
        );
      }

      throwIfAborted(signal);
      await this.review(session, policy, progress, signal);
      session.candidates = rankCandidates(session.candidates, session.reviews, {
        policy,
        crowdedCandidateIds: session.consensusCrowding?.crowdedCandidateIds,
      });
      this.store.save(session);

      throwIfAborted(signal);
      await this.falsify(session, policy, progress, signal);

      session.stage = 'reporting';
      await emitProgress(progress, session.stage, 0, 1, 'Writing inspectable report artifacts');
      session.status = 'completed';
      session.stage = 'completed';
      const markdown = renderMarkdownReport(session);
      const json = JSON.stringify(createPublicReport(session), null, 2);
      session.reportMarkdownPath = this.store.writeReport(session.id, 'report.md', markdown);
      session.reportJsonPath = this.store.writeReport(session.id, 'report.json', json);
      this.store.save(session);
      await emitProgress(progress, session.stage, 1, 1, `Report written for ${session.id}`);
      return session;
    } catch (error) {
      session.status = signal?.aborted ? 'interrupted' : 'failed';
      session.stage = signal?.aborted ? 'interrupted' : 'failed';
      session.error = error instanceof Error ? error.message : String(error);
      this.store.save(session);
      throw error;
    }
  }

  private async preflight(
    session: ResearchSession,
    progress?: ResearchProgressHandler,
    signal?: AbortSignal
  ): Promise<void> {
    session.stage = 'preflight';
    this.store.save(session);
    await preflightProviders(
      this.gateway,
      this.store,
      session,
      session.config.providers,
      session.config.minProviders,
      session.stage,
      progress,
      signal
    );
  }

  /**
   * The sources stage: user records plus what the web scouts propose are fetched, graded blind by
   * a council provider, rendered into a SOURCES appendix, and sealed into the packet. Scout
   * replies never reach a generator directly; only the deduplicated, verified records do.
   */
  private async source(
    session: ResearchSession,
    contextPacket: string,
    policy: DialPolicy,
    progress?: ResearchProgressHandler,
    signal?: AbortSignal
  ): Promise<string> {
    const config = session.config.sources;
    if (!config) return contextPacket;
    session.stage = 'sourcing';
    this.store.save(session);
    const { filePacket } = splitAppendix(contextPacket);
    let sources: SourceRecord[] = (session.sources ?? []).map((record) => ({
      ...record,
      verification: undefined,
      critique: undefined,
    }));
    const scoutCalls = config.scouts.length * config.rounds;
    const total = scoutCalls + 1 + (config.critique ? 1 : 0);
    let completed = 0;
    const contextPaths = session.contextManifest.files.map((file) => file.path);

    for (let round = 1; round <= config.rounds; round++) {
      const avoid = sources.flatMap((record) =>
        [record.url, record.doi ? `doi:${record.doi}` : undefined].filter((item): item is string =>
          Boolean(item)
        )
      );
      const prompt = buildSourceScoutPrompt(session.goal, policy, {
        count: config.sourcesPerScout,
        round,
        rounds: config.rounds,
        avoid,
        contextPaths,
      });
      // Every scout in a round gets the same sealed prompt; replies are merged only afterwards.
      const replies = await Promise.all(
        config.scouts.map(async (scout): Promise<{ scout: string; output?: SourceScoutOutput }> => {
          await emitProgress(progress, session.stage, completed, total, `${scout} scouting`, {
            subject: scout,
            event: 'started',
          });
          const suffix = round === 1 ? '' : `-r${round}`;
          try {
            const { parsed } = await this.calls.parseWithRepair(
              session,
              {
                id: `source-scout${suffix}-${scout}`,
                stage: 'source-scout',
                provider: scout,
                subject: 'sources',
                promptVersion: PROMPT_VERSIONS.sourceScout,
                prompt,
              },
              SourceScoutOutputSchema,
              (raw) => ({
                id: `source-scout${suffix}-repair-${scout}`,
                stage: 'source-scout-repair',
                provider: scout,
                subject: 'sources',
                promptVersion: PROMPT_VERSIONS.sourceScoutRepair,
                prompt: buildSourceScoutRepairPrompt(raw, config.sourcesPerScout),
              }),
              signal
            );
            return { scout, output: parsed };
          } catch (error) {
            if (signal?.aborted) throw error;
            session.warnings.push(
              `Source scouting failed for ${scout}${round > 1 ? ` (round ${round})` : ''}: ${error instanceof Error ? error.message : String(error)}`
            );
            return { scout };
          } finally {
            completed++;
            await emitProgress(
              progress,
              session.stage,
              completed,
              total,
              `Scouting ${completed}/${scoutCalls}`,
              { subject: scout, event: 'finished' }
            );
          }
        })
      );
      for (const reply of replies) {
        if (!reply.output) continue;
        const inputs: SourceInput[] = reply.output.sources
          .filter((item) => item.url || item.doi)
          .slice(0, config.sourcesPerScout)
          .map((item) => ({
            title: item.title,
            url: item.url ?? undefined,
            doi: item.doi ?? undefined,
            year: item.year ?? undefined,
            venue: item.venue ?? undefined,
            summary: item.summary ?? undefined,
            kind: item.kind ?? undefined,
          }));
        const dropped = reply.output.sources.length - inputs.length;
        if (dropped > 0) {
          session.warnings.push(
            `${reply.scout} proposed ${dropped} source${dropped === 1 ? '' : 's'} without a URL or DOI; discarded`
          );
        }
        const merged = normalizeSources(sources, inputs, 'scout', reply.scout);
        sources = merged.sources;
      }
      session.sources = sources;
      this.store.save(session);
    }

    await emitProgress(
      progress,
      session.stage,
      completed,
      total,
      config.verification === 'none'
        ? 'Skipping source fetches'
        : `Fetching ${sources.filter((record) => record.url || record.doi).length} source URLs`,
      { subject: 'sources', event: 'started' }
    );
    const verifier = config.verification === 'none' ? skippedVerifier : this.sourceVerifier;
    sources = await verifier.verify(sources, { mode: config.verification, signal });
    completed++;
    const kept: SourceRecord[] = [];
    const dropped: string[] = [];
    for (const record of sources) {
      const status = record.verification?.status;
      if (status === 'retracted') {
        dropped.push(`${record.id} (${record.title}) is retracted`);
        continue;
      }
      if (record.origin === 'scout' && (status === 'unreachable' || status === 'blocked')) {
        dropped.push(
          `${record.id} (${record.title}) could not be fetched: ${record.verification?.error ?? status}`
        );
        continue;
      }
      kept.push(record);
    }
    if (dropped.length > 0) {
      session.warnings.push(`Dropped ${dropped.length} source record(s): ${dropped.join('; ')}`);
    }
    sources = kept;
    await emitProgress(
      progress,
      session.stage,
      completed,
      total,
      `${sources.filter((record) => record.verification?.status === 'reachable').length} of ${sources.length} sources reachable`,
      { subject: 'sources', event: 'finished' }
    );

    if (config.critique && sources.length > 0 && session.providers.length > 0) {
      await this.critiqueSources(session, sources, policy, progress, { completed, total }, signal);
      completed++;
    }

    // Sources are packet context; trim the least reliable scouted records until they fit.
    const filePacketBytes = Buffer.byteLength(filePacket, 'utf8');
    const available = session.contextManifest.maxBytes - filePacketBytes - 2;
    const ordered = [...sources].sort(
      (left, right) =>
        sourcePriority(left) - sourcePriority(right) || left.id.localeCompare(right.id)
    );
    let included = [...ordered];
    let appendix = renderSourcesSection(included);
    while (included.length > 0 && Buffer.byteLength(appendix, 'utf8') > available) {
      included = included.slice(0, -1);
      appendix = included.length > 0 ? renderSourcesSection(included) : '';
    }
    if (included.length < sources.length) {
      session.warnings.push(
        `${sources.length - included.length} source record(s) did not fit the shared context budget and were left out of the packet`
      );
    }
    included.sort((left, right) => left.id.localeCompare(right.id));
    appendix = included.length > 0 ? renderSourcesSection(included) : '';
    const rebuilt = withAppendix(
      { packet: filePacket, manifest: { ...session.contextManifest, appendixBytes: undefined } },
      appendix
    );
    if (rebuilt.manifest.appendixBytes === undefined) delete rebuilt.manifest.appendixBytes;
    session.contextManifest = rebuilt.manifest;
    session.sources = included;
    session.sourcesCompletedAt = new Date().toISOString();
    this.store.writeContextPacket(session.id, rebuilt.packet);
    this.store.writeReport(
      session.id,
      'context-manifest.json',
      JSON.stringify(rebuilt.manifest, null, 2)
    );
    this.store.writeReport(session.id, 'sources.json', JSON.stringify(included, null, 2));
    if (appendix) this.store.writeReport(session.id, 'sources-section.txt', appendix);
    this.store.save(session);
    return rebuilt.packet;
  }

  private async critiqueSources(
    session: ResearchSession,
    sources: SourceRecord[],
    policy: DialPolicy,
    progress: ResearchProgressHandler | undefined,
    counter: { completed: number; total: number },
    signal?: AbortSignal
  ): Promise<void> {
    const providers = [...session.providers].sort();
    const batches: SourceRecord[][] = [];
    for (let index = 0; index < sources.length; index += CRITIQUE_BATCH_SIZE) {
      batches.push(sources.slice(index, index + CRITIQUE_BATCH_SIZE));
    }
    await emitProgress(
      progress,
      session.stage,
      counter.completed,
      counter.total,
      `Grading ${sources.length} sources`,
      { subject: 'sources', event: 'started' }
    );
    await Promise.all(
      batches.map(async (batch, index) => {
        const grader =
          providers[
            stableHash(`${session.config.seed}:source-critique:${index}`) % providers.length
          ];
        try {
          const { parsed } = await this.calls.parseWithRepair(
            session,
            {
              id: `source-critique-${index + 1}-${grader}`,
              stage: 'source-critique',
              provider: grader,
              subject: 'sources',
              promptVersion: PROMPT_VERSIONS.sourceCritique,
              prompt: buildSourceCritiquePrompt(session.goal, batch, policy),
            },
            SourceCritiqueOutputSchema,
            (raw) => ({
              id: `source-critique-${index + 1}-repair-${grader}`,
              stage: 'source-critique-repair',
              provider: grader,
              subject: 'sources',
              promptVersion: PROMPT_VERSIONS.sourceCritiqueRepair,
              prompt: buildSourceCritiqueRepairPrompt(raw),
            }),
            signal
          );
          for (const assessment of parsed.assessments) {
            const record = batch.find(
              (item) => item.id.toUpperCase() === assessment.id.trim().toUpperCase()
            );
            if (!record) continue;
            record.critique = {
              reliability: Math.round(assessment.reliability),
              replication: assessment.replication,
              concerns: assessment.concerns.map((concern) => concern.trim()).filter(Boolean),
            };
            if (assessment.kind) record.kind = assessment.kind;
          }
        } catch (error) {
          if (signal?.aborted) throw error;
          session.warnings.push(
            `Source critique failed for batch ${index + 1}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      })
    );
    await emitProgress(
      progress,
      session.stage,
      counter.completed + 1,
      counter.total,
      `${sources.filter((record) => record.critique).length} of ${sources.length} sources graded`,
      { subject: 'sources', event: 'finished' }
    );
  }

  private generationTasks(
    session: ResearchSession,
    contextPacket: string,
    policy: DialPolicy
  ): GenerationTask[] {
    const count = session.config.hypothesesPerProvider;
    const standardPrompt = buildGenerationPrompt(
      session.goal,
      contextPacket,
      count,
      policy,
      'standard'
    );
    const outOfBoxPrompt =
      policy.outOfBoxCalls > 0
        ? buildGenerationPrompt(
            session.goal,
            contextPacket,
            policy.outOfBoxHypotheses,
            policy,
            'out-of-box'
          )
        : undefined;
    return session.providers.flatMap((provider): GenerationTask[] => {
      const standard: GenerationTask = {
        provider,
        variant: 'standard',
        count,
        spec: {
          id: `generation-${provider}`,
          stage: 'generation',
          provider,
          subject: 'all',
          promptVersion: PROMPT_VERSIONS.generation,
          prompt: standardPrompt,
        },
      };
      if (!outOfBoxPrompt) return [standard];
      const outOfBox: GenerationTask = {
        provider,
        variant: 'out-of-box',
        count: policy.outOfBoxHypotheses,
        spec: {
          id: `generation-outofbox-${provider}`,
          stage: 'generation-outofbox',
          provider,
          subject: 'all',
          promptVersion: PROMPT_VERSIONS.generationOutOfBox,
          prompt: outOfBoxPrompt,
        },
      };
      return [standard, outOfBox];
    });
  }

  private async generate(
    session: ResearchSession,
    contextPacket: string,
    policy: DialPolicy,
    progress?: ResearchProgressHandler,
    signal?: AbortSignal
  ): Promise<void> {
    session.stage = 'generating';
    this.store.save(session);
    const tasks = this.generationTasks(session, contextPacket, policy);
    let completed = 0;
    // Every generation call, including the out-of-the-box batch, runs inside one sealed
    // Promise.all: no reply is parsed or shown to another provider until all of them are in.
    const initial: GenerationResult[] = await Promise.all(
      tasks.map(async (task): Promise<GenerationResult> => {
        await emitProgress(
          progress,
          session.stage,
          completed,
          tasks.length,
          task.variant === 'standard'
            ? `${task.provider} generating`
            : `${task.provider} generating out-of-the-box`,
          { subject: task.provider, event: 'started' }
        );
        try {
          const { completion, callId } = await this.calls.invokeWithBlankRetry(
            session,
            task.spec,
            signal
          );
          return { task, completion, callId };
        } catch (error) {
          return { task, error };
        } finally {
          completed++;
          await emitProgress(
            progress,
            session.stage,
            completed,
            tasks.length,
            `Generation ${completed}/${tasks.length}; candidates sealed`,
            { subject: task.provider, event: 'finished' }
          );
        }
      })
    );

    const parsedBatches: Array<{
      task: GenerationTask;
      model: string;
      output: GenerationOutput;
    }> = [];
    for (const result of initial) {
      const { task } = result;
      const noun = task.variant === 'standard' ? 'generation' : 'out-of-the-box generation';
      if (!('completion' in result)) {
        session.warnings.push(
          `${noun.charAt(0).toUpperCase()}${noun.slice(1)} failed for ${task.provider}`
        );
        continue;
      }
      try {
        const { parsed, completion } = await this.calls.parseOrRepair(
          session,
          { completion: result.completion, callId: result.callId },
          GenerationOutputSchema,
          (raw) => ({
            id:
              task.variant === 'standard'
                ? `generation-repair-${task.provider}`
                : `generation-outofbox-repair-${task.provider}`,
            stage: 'generation-repair',
            provider: task.provider,
            subject: 'all',
            promptVersion: PROMPT_VERSIONS.generationRepair,
            prompt: buildGenerationRepairPrompt(raw, task.count),
          }),
          signal
        );
        parsedBatches.push({ task, model: completion.model, output: parsed });
      } catch (error) {
        session.warnings.push(
          `Structured ${noun} failed for ${task.provider}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    const validProviders = [
      ...new Set(
        parsedBatches
          .filter((batch) => batch.task.variant === 'standard')
          .map((batch) => batch.task.provider)
      ),
    ].sort();
    if (validProviders.length < session.config.minProviders) {
      throw new Error(
        `Only ${validProviders.length} providers produced valid hypotheses; ${session.config.minProviders} required`
      );
    }
    session.providers = validProviders;
    const createdAt = new Date().toISOString();
    // Quotes are checked against the file part of the packet only, so a source summary can
    // never be laundered into "context" evidence; source citations resolve against the records.
    const { filePacket } = splitAppendix(contextPacket);
    const sources = session.sources ?? [];
    let hypothesisNumber = 1;
    const variantOrder = (variant: GenerationVariant) => (variant === 'standard' ? 0 : 1);
    session.candidates = parsedBatches
      .sort(
        (left, right) =>
          left.task.provider.localeCompare(right.task.provider) ||
          variantOrder(left.task.variant) - variantOrder(right.task.variant)
      )
      .flatMap(({ task, model, output }) => {
        const hypotheses = output.hypotheses.slice(0, task.count);
        if (hypotheses.length < task.count) {
          session.warnings.push(
            `${task.provider} returned ${hypotheses.length}/${task.count} requested ${task.variant === 'standard' ? '' : 'out-of-the-box '}hypotheses`
          );
        }
        return hypotheses.map(
          (hypothesis, generationIndex): HypothesisCandidate => ({
            ...hypothesis,
            // Deterministic provenance check against the sealed packet; no model is consulted.
            evidence: verifyEvidence(hypothesis.evidence, filePacket, sources),
            id: `H-${String(hypothesisNumber++).padStart(3, '0')}`,
            sessionId: session.id,
            generationIndex,
            variant: task.variant,
            authorProvider: task.provider,
            authorModel: model,
            status: 'distinct',
            createdAt,
          })
        );
      });
    this.store.save(session);
  }

  private async review(
    session: ResearchSession,
    policy: DialPolicy,
    progress?: ResearchProgressHandler,
    signal?: AbortSignal
  ): Promise<void> {
    session.stage = 'reviewing';
    this.store.save(session);
    const distinct = session.candidates.filter((candidate) => candidate.status === 'distinct');
    const assignments = assignReviewers(distinct, session.providers, session.config.seed);
    const pending = distinct.filter(
      (candidate) => !session.reviews.some((review) => review.hypothesisId === candidate.id)
    );
    let completed = distinct.length - pending.length;
    await Promise.all(
      pending.map(async (candidate) => {
        const reviewer = assignments.get(candidate.id);
        if (!reviewer) return;
        await emitProgress(
          progress,
          session.stage,
          completed,
          distinct.length,
          `Reviewing ${candidate.id}`,
          { subject: candidate.id, event: 'started' }
        );
        try {
          const { parsed } = await this.calls.parseWithRepair(
            session,
            {
              id: `review-${candidate.id}-${reviewer}`,
              stage: 'review',
              provider: reviewer,
              subject: candidate.id,
              promptVersion: PROMPT_VERSIONS.review,
              prompt: buildReviewPrompt(session.goal, candidate, policy),
            },
            ReviewOutputSchema,
            (raw) => ({
              id: `review-repair-${candidate.id}-${reviewer}`,
              stage: 'review-repair',
              provider: reviewer,
              subject: candidate.id,
              promptVersion: PROMPT_VERSIONS.reviewRepair,
              prompt: buildReviewRepairPrompt(raw),
            }),
            signal
          );
          const review: HypothesisReview = {
            ...parsed,
            id: `RV-${candidate.id}`,
            sessionId: session.id,
            hypothesisId: candidate.id,
            reviewerProvider: reviewer,
            selfReview: reviewer === candidate.authorProvider,
            createdAt: new Date().toISOString(),
          };
          session.reviews = [...session.reviews.filter((item) => item.id !== review.id), review];
          this.store.save(session);
        } catch (error) {
          session.warnings.push(
            `Review failed for ${candidate.id}: ${error instanceof Error ? error.message : String(error)}`
          );
        } finally {
          completed++;
          await emitProgress(
            progress,
            session.stage,
            completed,
            distinct.length,
            `Reviewed ${completed}/${distinct.length}`,
            { subject: candidate.id, event: 'finished' }
          );
        }
      })
    );
  }

  private async falsify(
    session: ResearchSession,
    policy: DialPolicy,
    progress?: ResearchProgressHandler,
    signal?: AbortSignal
  ): Promise<void> {
    session.stage = 'falsifying';
    this.store.save(session);
    const finalists = session.candidates
      .filter((candidate) => candidate.status === 'distinct')
      .sort((left, right) => (left.rank || 999) - (right.rank || 999))
      .slice(0, session.config.topK);
    const rounds = Math.max(1, policy.falsificationRounds);
    const counter = { completed: 0, total: finalists.length * rounds, rounds };

    const firstRound = assignReviewers(finalists, session.providers, session.config.seed + 1);
    await this.attack(session, finalists, firstRound, 1, policy, counter, progress, signal);

    for (let round = 2; round <= rounds; round++) {
      // Rounds run one after another so a later attacker can be someone who has not attacked
      // this finalist yet; the earlier attacks themselves are never shown to it.
      const exclude = new Map<string, string[]>();
      for (const candidate of finalists) {
        exclude.set(
          candidate.id,
          session.falsifications
            .filter((attack) => attack.hypothesisId === candidate.id && (attack.round ?? 1) < round)
            .map((attack) => attack.reviewerProvider)
        );
      }
      const assignments = assignReviewers(
        finalists,
        session.providers,
        session.config.seed + round,
        { exclude }
      );
      await this.attack(session, finalists, assignments, round, policy, counter, progress, signal);
    }
  }

  private async attack(
    session: ResearchSession,
    finalists: HypothesisCandidate[],
    assignments: Map<string, string>,
    round: number,
    policy: DialPolicy,
    counter: { completed: number; total: number; rounds: number },
    progress?: ResearchProgressHandler,
    signal?: AbortSignal
  ): Promise<void> {
    const pending = finalists.filter(
      (candidate) =>
        !session.falsifications.some(
          (attack) => attack.hypothesisId === candidate.id && (attack.round ?? 1) === round
        )
    );
    counter.completed += finalists.length - pending.length;
    const suffix = round === 1 ? '' : `-r${round}`;
    const roundLabel = round === 1 ? '' : ` (round ${round})`;
    await Promise.all(
      pending.map(async (candidate) => {
        const reviewer = assignments.get(candidate.id);
        if (!reviewer) return;
        await emitProgress(
          progress,
          session.stage,
          counter.completed,
          counter.total,
          `Attacking ${candidate.id}${roundLabel}`,
          { subject: candidate.id, event: 'started' }
        );
        try {
          const { parsed } = await this.calls.parseWithRepair(
            session,
            {
              id: `falsification${suffix}-${candidate.id}-${reviewer}`,
              stage: 'falsification',
              provider: reviewer,
              subject: candidate.id,
              promptVersion: PROMPT_VERSIONS.falsification,
              prompt: buildFalsificationPrompt(session.goal, candidate, policy, round),
            },
            FalsificationOutputSchema,
            (raw) => ({
              id: `falsification${suffix}-repair-${candidate.id}-${reviewer}`,
              stage: 'falsification-repair',
              provider: reviewer,
              subject: candidate.id,
              promptVersion: PROMPT_VERSIONS.falsificationRepair,
              prompt: buildFalsificationRepairPrompt(raw),
            }),
            signal
          );
          const attack: HypothesisFalsification = {
            ...parsed,
            id: `FA-${candidate.id}${suffix}`,
            sessionId: session.id,
            hypothesisId: candidate.id,
            reviewerProvider: reviewer,
            round,
            createdAt: new Date().toISOString(),
          };
          if (round > 1 && reviewer === candidate.authorProvider) {
            session.warnings.push(
              `Falsification round ${round} for ${candidate.id} came from its own author because no other provider was available.`
            );
          }
          session.falsifications = [
            ...session.falsifications.filter((item) => item.id !== attack.id),
            attack,
          ];
          this.store.save(session);
        } catch (error) {
          session.warnings.push(
            `Falsification failed for ${candidate.id}${roundLabel}: ${error instanceof Error ? error.message : String(error)}`
          );
        } finally {
          counter.completed++;
          await emitProgress(
            progress,
            session.stage,
            counter.completed,
            counter.total,
            `Falsified ${counter.completed}/${counter.total} ${counter.rounds > 1 ? 'attacks' : 'finalists'}`,
            { subject: candidate.id, event: 'finished' }
          );
        }
      })
    );
  }
}
