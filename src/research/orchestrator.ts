import { buildContextPacket } from './context.js';
import { calculateContextBudget } from './context-budget.js';
import { deduplicateCandidates } from './dedup.js';
import { assignReviewers } from './assignment.js';
import { parseStructuredOutput } from './parsing.js';
import {
  FalsificationOutputSchema,
  GenerationOutputSchema,
  ReviewOutputSchema,
  type GenerationOutput,
  type ReviewOutput,
  type FalsificationOutput,
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
} from './prompts.js';
import { rankCandidates } from './ranking.js';
import { createPublicReport, renderMarkdownReport } from './report.js';
import { ResearchSessionStore } from './store.js';
import type {
  HypothesisCandidate,
  HypothesisFalsification,
  HypothesisReview,
  ProviderCallRecord,
  ResearchCompletion,
  ResearchProgressHandler,
  ResearchProviderGateway,
  ResearchRunApproval,
  ResearchSession,
  RunResearchInput,
} from './types.js';

const DEFAULT_HYPOTHESES_PER_PROVIDER = 3;
const DEFAULT_TOP_K = 3;

interface CallSpec {
  id: string;
  stage: ProviderCallRecord['stage'];
  provider: string;
  subject: string;
  promptVersion: string;
  prompt: string;
}

export class HypothesisCouncilService {
  constructor(
    private readonly gateway: ResearchProviderGateway,
    readonly store: ResearchSessionStore
  ) {}

  async run(
    input: RunResearchInput,
    progress?: ResearchProgressHandler,
    signal?: AbortSignal,
    approve?: ResearchRunApproval
  ): Promise<ResearchSession> {
    if (!input.goal.trim()) throw new Error('A research goal is required');
    const sessionId = this.store.createId();
    const workingDirectory = this.store.sessionDirectory(sessionId);
    const descriptors = await this.gateway.listProviders(workingDirectory, signal);
    const defaultProviders = descriptors.filter((provider) => provider.type === 'cli');
    const requestedProviders = [
      ...new Set(
        input.providers?.length
          ? input.providers
          : (defaultProviders.length > 0 ? defaultProviders : descriptors).map(
              (provider) => provider.name
            )
      ),
    ].sort();
    if (requestedProviders.length === 0) throw new Error('No Rubber Duck providers are configured');

    const minProviders = input.minProviders ?? Math.min(2, requestedProviders.length);
    const contextBudget = calculateContextBudget(
      descriptors,
      requestedProviders,
      input.maxContextBytes
    );
    const contextRoot = input.contextRoot || process.cwd();
    const context = buildContextPacket(
      input.contextPaths || [],
      contextBudget.maxBytes,
      contextRoot,
      { markdownOnly: input.markdownOnly }
    );
    await approve?.({
      goal: input.goal.trim(),
      providers: requestedProviders,
      contextManifest: context.manifest,
      contextBudget,
      contextRoot,
      markdownOnly: input.markdownOnly === true,
    });
    const now = new Date().toISOString();
    const session: ResearchSession = {
      version: 1,
      id: sessionId,
      goal: input.goal.trim(),
      status: 'running',
      stage: 'created',
      createdAt: now,
      updatedAt: now,
      config: {
        providers: requestedProviders,
        hypothesesPerProvider: input.hypothesesPerProvider || DEFAULT_HYPOTHESES_PER_PROVIDER,
        topK: input.topK || DEFAULT_TOP_K,
        minProviders,
        seed: input.seed ?? 42,
        maxContextBytes: contextBudget.maxBytes,
        contextPaths: input.contextPaths || [],
        contextRoot,
        markdownOnly: input.markdownOnly === true,
        contextBudget,
      },
      providers: [],
      unavailableProviders: [],
      contextManifest: context.manifest,
      candidates: [],
      reviews: [],
      falsifications: [],
      calls: [],
      warnings: [],
    };
    if (requestedProviders.length === 1) {
      session.warnings.push(
        'Single-provider mode: reviews cannot provide independent authorship separation.'
      );
    }
    const assumedLimits = contextBudget.providerLimits
      .filter((limit) => limit.source === 'provider-default')
      .map((limit) => limit.provider);
    if (assumedLimits.length > 0) {
      session.warnings.push(
        `Context limits use conservative provider defaults for: ${assumedLimits.join(', ')}. Configure per-provider token overrides when needed.`
      );
    }
    const transportLimits = contextBudget.providerLimits
      .filter((limit) => limit.transportLimited)
      .map((limit) => limit.provider);
    if (transportLimits.length > 0) {
      session.warnings.push(
        `Context is capped by command-argument transport for: ${transportLimits.join(', ')}.`
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
    signal?: AbortSignal
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
    const completion = await this.invoke(
      session,
      {
        id: `ask-${Date.now()}`,
        stage: 'ask',
        provider: selectedProvider,
        subject: session.id,
        promptVersion: PROMPT_VERSIONS.ask,
        prompt: buildSessionAskPrompt(session, question, priorTurns),
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
    try {
      this.throwIfAborted(signal);
      await this.preflight(session, progress, signal);
      if (session.candidates.length === 0) {
        await this.generate(session, contextPacket, progress, signal);
        session.stage = 'deduplicating';
        await this.emit(progress, session.stage, 0, 1, 'Clustering lexical duplicates');
        session.candidates = deduplicateCandidates(session.candidates);
        this.store.save(session);
        await this.emit(
          progress,
          session.stage,
          1,
          1,
          `${session.candidates.filter((candidate) => candidate.status === 'distinct').length} distinct candidates`
        );
      }

      this.throwIfAborted(signal);
      await this.review(session, progress, signal);
      session.candidates = rankCandidates(session.candidates, session.reviews);
      this.store.save(session);

      this.throwIfAborted(signal);
      await this.falsify(session, progress, signal);

      session.stage = 'reporting';
      await this.emit(progress, session.stage, 0, 1, 'Writing inspectable report artifacts');
      session.status = 'completed';
      session.stage = 'completed';
      const markdown = renderMarkdownReport(session);
      const json = JSON.stringify(createPublicReport(session), null, 2);
      session.reportMarkdownPath = this.store.writeReport(session.id, 'report.md', markdown);
      session.reportJsonPath = this.store.writeReport(session.id, 'report.json', json);
      this.store.save(session);
      await this.emit(progress, session.stage, 1, 1, `Report written for ${session.id}`);
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
    const known = new Set(
      (await this.gateway.listProviders(this.store.sessionDirectory(session.id), signal)).map(
        (provider) => provider.name
      )
    );
    const requested = session.config.providers;
    let completed = 0;
    const results = await Promise.all(
      requested.map(async (provider) => {
        const healthy =
          known.has(provider) &&
          (await this.gateway
            .healthCheck(provider, this.store.sessionDirectory(session.id), signal)
            .catch(() => false));
        completed++;
        await this.emit(
          progress,
          session.stage,
          completed,
          requested.length,
          `${provider}: ${healthy ? 'ready' : 'unavailable'}`
        );
        return { provider, healthy };
      })
    );
    session.providers = results.filter((result) => result.healthy).map((result) => result.provider);
    session.unavailableProviders = results
      .filter((result) => !result.healthy)
      .map((result) => result.provider);
    if (session.unavailableProviders.length > 0) {
      session.warnings.push(`Unavailable providers: ${session.unavailableProviders.join(', ')}`);
    }
    if (session.providers.length < session.config.minProviders) {
      throw new Error(
        `Preflight found ${session.providers.length} usable providers; ${session.config.minProviders} required`
      );
    }
    this.store.save(session);
  }

  private async generate(
    session: ResearchSession,
    contextPacket: string,
    progress?: ResearchProgressHandler,
    signal?: AbortSignal
  ): Promise<void> {
    session.stage = 'generating';
    this.store.save(session);
    const prompt = buildGenerationPrompt(
      session.goal,
      contextPacket,
      session.config.hypothesesPerProvider
    );
    let completed = 0;
    const initial = await Promise.all(
      session.providers.map(async (provider) => {
        try {
          return {
            provider,
            completion: await this.invoke(
              session,
              {
                id: `generation-${provider}`,
                stage: 'generation',
                provider,
                subject: 'all',
                promptVersion: PROMPT_VERSIONS.generation,
                prompt,
              },
              signal
            ),
          };
        } catch (error) {
          return { provider, error };
        } finally {
          completed++;
          await this.emit(
            progress,
            session.stage,
            completed,
            session.providers.length,
            `Generation ${completed}/${session.providers.length}; candidates sealed`
          );
        }
      })
    );

    const parsedByProvider: Array<{
      provider: string;
      model: string;
      output: GenerationOutput;
    }> = [];
    for (const result of initial) {
      if (!result.completion) {
        session.warnings.push(`Generation failed for ${result.provider}`);
        continue;
      }
      let completion = result.completion;
      let callId = `generation-${result.provider}`;
      try {
        let parsed: GenerationOutput;
        try {
          parsed = parseStructuredOutput(completion.content, GenerationOutputSchema);
        } catch {
          callId = `generation-repair-${result.provider}`;
          completion = await this.invoke(
            session,
            {
              id: callId,
              stage: 'generation-repair',
              provider: result.provider,
              subject: 'all',
              promptVersion: PROMPT_VERSIONS.generationRepair,
              prompt: buildGenerationRepairPrompt(
                completion.content,
                session.config.hypothesesPerProvider
              ),
            },
            signal
          );
          parsed = parseStructuredOutput(completion.content, GenerationOutputSchema);
        }
        this.recordParsed(session, callId, parsed);
        parsedByProvider.push({
          provider: result.provider,
          model: completion.model,
          output: parsed,
        });
      } catch (error) {
        session.warnings.push(
          `Structured generation failed for ${result.provider}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (parsedByProvider.length < session.config.minProviders) {
      throw new Error(
        `Only ${parsedByProvider.length} providers produced valid hypotheses; ${session.config.minProviders} required`
      );
    }
    session.providers = parsedByProvider.map((result) => result.provider).sort();
    const createdAt = new Date().toISOString();
    let hypothesisNumber = 1;
    session.candidates = parsedByProvider
      .sort((left, right) => left.provider.localeCompare(right.provider))
      .flatMap(({ provider, model, output }) => {
        const hypotheses = output.hypotheses.slice(0, session.config.hypothesesPerProvider);
        if (hypotheses.length < session.config.hypothesesPerProvider) {
          session.warnings.push(
            `${provider} returned ${hypotheses.length}/${session.config.hypothesesPerProvider} requested hypotheses`
          );
        }
        return hypotheses.map(
          (hypothesis, generationIndex): HypothesisCandidate => ({
            ...hypothesis,
            id: `H-${String(hypothesisNumber++).padStart(3, '0')}`,
            sessionId: session.id,
            generationIndex,
            authorProvider: provider,
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
        try {
          let callId = `review-${candidate.id}-${reviewer}`;
          let completion = await this.invoke(
            session,
            {
              id: callId,
              stage: 'review',
              provider: reviewer,
              subject: candidate.id,
              promptVersion: PROMPT_VERSIONS.review,
              prompt: buildReviewPrompt(session.goal, candidate),
            },
            signal
          );
          let parsed: ReviewOutput;
          try {
            parsed = parseStructuredOutput(completion.content, ReviewOutputSchema);
          } catch {
            callId = `review-repair-${candidate.id}-${reviewer}`;
            completion = await this.invoke(
              session,
              {
                id: callId,
                stage: 'review-repair',
                provider: reviewer,
                subject: candidate.id,
                promptVersion: PROMPT_VERSIONS.reviewRepair,
                prompt: buildReviewRepairPrompt(completion.content),
              },
              signal
            );
            parsed = parseStructuredOutput(completion.content, ReviewOutputSchema);
          }
          this.recordParsed(session, callId, parsed);
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
          await this.emit(
            progress,
            session.stage,
            completed,
            distinct.length,
            `Reviewed ${completed}/${distinct.length}`
          );
        }
      })
    );
  }

  private async falsify(
    session: ResearchSession,
    progress?: ResearchProgressHandler,
    signal?: AbortSignal
  ): Promise<void> {
    session.stage = 'falsifying';
    this.store.save(session);
    const finalists = session.candidates
      .filter((candidate) => candidate.status === 'distinct')
      .sort((left, right) => (left.rank || 999) - (right.rank || 999))
      .slice(0, session.config.topK);
    const assignments = assignReviewers(finalists, session.providers, session.config.seed + 1);
    const pending = finalists.filter(
      (candidate) => !session.falsifications.some((attack) => attack.hypothesisId === candidate.id)
    );
    let completed = finalists.length - pending.length;
    await Promise.all(
      pending.map(async (candidate) => {
        const reviewer = assignments.get(candidate.id);
        if (!reviewer) return;
        try {
          let callId = `falsification-${candidate.id}-${reviewer}`;
          let completion = await this.invoke(
            session,
            {
              id: callId,
              stage: 'falsification',
              provider: reviewer,
              subject: candidate.id,
              promptVersion: PROMPT_VERSIONS.falsification,
              prompt: buildFalsificationPrompt(session.goal, candidate),
            },
            signal
          );
          let parsed: FalsificationOutput;
          try {
            parsed = parseStructuredOutput(completion.content, FalsificationOutputSchema);
          } catch {
            callId = `falsification-repair-${candidate.id}-${reviewer}`;
            completion = await this.invoke(
              session,
              {
                id: callId,
                stage: 'falsification-repair',
                provider: reviewer,
                subject: candidate.id,
                promptVersion: PROMPT_VERSIONS.falsificationRepair,
                prompt: buildFalsificationRepairPrompt(completion.content),
              },
              signal
            );
            parsed = parseStructuredOutput(completion.content, FalsificationOutputSchema);
          }
          this.recordParsed(session, callId, parsed);
          const attack: HypothesisFalsification = {
            ...parsed,
            id: `FA-${candidate.id}`,
            sessionId: session.id,
            hypothesisId: candidate.id,
            reviewerProvider: reviewer,
            createdAt: new Date().toISOString(),
          };
          session.falsifications = [
            ...session.falsifications.filter((item) => item.id !== attack.id),
            attack,
          ];
          this.store.save(session);
        } catch (error) {
          session.warnings.push(
            `Falsification failed for ${candidate.id}: ${error instanceof Error ? error.message : String(error)}`
          );
        } finally {
          completed++;
          await this.emit(
            progress,
            session.stage,
            completed,
            finalists.length,
            `Falsified ${completed}/${finalists.length} finalists`
          );
        }
      })
    );
  }

  private async invoke(
    session: ResearchSession,
    spec: CallSpec,
    signal?: AbortSignal
  ): Promise<ResearchCompletion> {
    this.throwIfAborted(signal);
    const startedAt = new Date().toISOString();
    let record: ProviderCallRecord;
    try {
      const completion = await this.gateway.complete(spec.provider, spec.prompt, {
        workingDirectory: this.store.sessionDirectory(session.id),
        signal,
      });
      const rawPath = this.store.writeCallArtifact(
        session.id,
        spec.stage,
        spec.id,
        'raw',
        completion.content
      );
      record = {
        id: spec.id,
        stage: spec.stage,
        provider: spec.provider,
        subject: spec.subject,
        promptVersion: spec.promptVersion,
        startedAt,
        endedAt: new Date().toISOString(),
        success: true,
        rawPath,
      };
      this.upsertCall(session, record);
      return completion;
    } catch (error) {
      record = {
        id: spec.id,
        stage: spec.stage,
        provider: spec.provider,
        subject: spec.subject,
        promptVersion: spec.promptVersion,
        startedAt,
        endedAt: new Date().toISOString(),
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      this.upsertCall(session, record);
      throw error;
    }
  }

  private recordParsed(session: ResearchSession, callId: string, value: unknown): void {
    const call = session.calls.find((item) => item.id === callId);
    if (!call) return;
    call.parsedPath = this.store.writeCallArtifact(
      session.id,
      call.stage,
      callId,
      'parsed',
      JSON.stringify(value, null, 2)
    );
    this.store.save(session);
  }

  private upsertCall(session: ResearchSession, record: ProviderCallRecord): void {
    session.calls = [...session.calls.filter((call) => call.id !== record.id), record].sort(
      (left, right) => left.id.localeCompare(right.id)
    );
    this.store.save(session);
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error('Research session cancelled');
  }

  private async emit(
    progress: ResearchProgressHandler | undefined,
    stage: ResearchSession['stage'],
    completed: number,
    total: number,
    message: string
  ): Promise<void> {
    await progress?.({ stage, completed, total, message });
  }
}
