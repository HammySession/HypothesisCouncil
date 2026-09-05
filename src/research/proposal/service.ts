import { assignReviewers, stableHash } from '../assignment.js';
import {
  CouncilCalls,
  emitProgress,
  preflightProviders,
  throwIfAborted,
  type CallSpec,
} from '../calls.js';
import { buildContextPacket, type BuiltContext } from '../context.js';
import { calculateContextBudget } from '../context-budget.js';
import { resolveDialPolicy } from '../dials.js';
import { dialConfigFrom } from '../settings.js';
import type { ResearchSessionStore } from '../store.js';
import type {
  ResearchProgressHandler,
  ResearchProviderGateway,
  ResearchSession,
} from '../types.js';
import {
  activeInterviewers,
  currentRound,
  interviewDone,
  mergeQuestions,
  openQuestions,
  rankDrafts,
  rankedDrafts,
  visibleQuestions,
  type IncomingQuestions,
} from './interview.js';
import {
  PROPOSAL_PROMPT_VERSIONS,
  buildInterviewPrompt,
  buildInterviewRepairPrompt,
  buildProposalAskPrompt,
  buildProposalCritiquePrompt,
  buildProposalCritiqueRepairPrompt,
  buildProposalDraftPrompt,
  buildProposalDraftRepairPrompt,
  buildProposalSynthesisPrompt,
  buildProposalSynthesisRepairPrompt,
} from './prompts.js';
import { createPublicProposalReport, priorFindingsFrom } from './public.js';
import { renderProposalMarkdown, renderTranscriptMarkdown } from './report.js';
import {
  InterviewOutputSchema,
  MergedProposalOutputSchema,
  ProposalCritiqueOutputSchema,
  ProposalDraftOutputSchema,
} from './schemas.js';
import { ProposalSessionStore } from './store.js';
import type {
  InterviewRound,
  MergedProposal,
  PlannedProposalCalls,
  ProposalApproval,
  ProposalDraft,
  ProposalPreview,
  ProposalSession,
  ProposeInput,
} from './types.js';

export const PROPOSAL_DEFAULTS = {
  maxRounds: 2,
  maxQuestionsPerProvider: 5,
  maxQuestionsPerRound: 8,
  seed: 42,
} as const;

/** Upper bound on model calls before repairs and blank-reply retries. */
export function planProposalCalls(
  providerCount: number,
  maxRounds: number,
  interview: boolean,
  mergeStrategy: 'synthesize' | 'pick'
): PlannedProposalCalls {
  const interviewCalls = interview ? providerCount * maxRounds : 0;
  const drafts = providerCount;
  const critiques = providerCount;
  const synthesis = mergeStrategy === 'synthesize' && providerCount > 1 ? 1 : 0;
  return {
    interview: interviewCalls,
    drafts,
    critiques,
    synthesis,
    total: interviewCalls + drafts + critiques + synthesis,
  };
}

export interface ProposalServiceOptions {
  /** Council store used to seed a proposal from a completed council session. */
  councilStore?: Pick<ResearchSessionStore, 'load'>;
}

export type ProposalAnswers = Record<string, string | null>;

/**
 * Research proposal workflow: interview the person round by round, draft proposals independently,
 * critique them blind, and merge them into one proposal. The service never blocks on the person;
 * every wait point is a persisted stage the CLI or MCP adapter returns from and resumes later.
 */
export class ResearchProposalService {
  private readonly calls: CouncilCalls<ProposalSession>;

  constructor(
    private readonly gateway: ResearchProviderGateway,
    readonly store: ProposalSessionStore,
    private readonly options: ProposalServiceOptions = {}
  ) {
    this.calls = new CouncilCalls(gateway, store);
  }

  async preview(input: ProposeInput, signal?: AbortSignal): Promise<ProposalPreview> {
    const prepared = await this.prepare(input, this.store.sessionDirectory('preview'), signal);
    return prepared.preview;
  }

  /** Create the session, preflight the council, and run the first interview round. */
  async start(
    input: ProposeInput,
    progress?: ResearchProgressHandler,
    signal?: AbortSignal,
    approve?: ProposalApproval
  ): Promise<ProposalSession> {
    const sessionId = this.store.createId();
    const workingDirectory = this.store.sessionDirectory(sessionId);
    const { preview, context, priorFindings, seeded } = await this.prepare(
      input,
      workingDirectory,
      signal
    );
    await approve?.(preview);
    const now = new Date().toISOString();
    const session: ProposalSession = {
      version: 1,
      kind: 'proposal',
      id: sessionId,
      topic: preview.topic,
      meta: input.meta,
      status: 'running',
      stage: 'created',
      createdAt: now,
      updatedAt: now,
      config: {
        providers: preview.providers,
        minProviders: preview.minProviders,
        seed: input.seed ?? PROPOSAL_DEFAULTS.seed,
        maxRounds: preview.maxRounds,
        maxQuestionsPerProvider:
          input.maxQuestionsPerProvider ?? PROPOSAL_DEFAULTS.maxQuestionsPerProvider,
        maxQuestionsPerRound: input.maxQuestionsPerRound ?? PROPOSAL_DEFAULTS.maxQuestionsPerRound,
        interviewVisibility: preview.interviewVisibility,
        mergeStrategy: preview.mergeStrategy,
        interview: preview.interview,
        dials: preview.dials,
        policy: preview.policy,
        fromSessionId: preview.fromSessionId,
        contextPaths: seeded.contextPaths,
        contextRoot: preview.contextRoot,
        markdownOnly: preview.markdownOnly,
        maxContextBytes: preview.contextBudget.maxBytes,
        contextBudget: preview.contextBudget,
      },
      providers: [],
      unavailableProviders: [],
      contextManifest: context.manifest,
      priorFindings,
      questions: [],
      rounds: [],
      drafts: [],
      critiques: [],
      handoffs: [],
      calls: [],
      warnings: [],
    };
    if (preview.providers.length === 1) {
      session.warnings.push(
        'Single-provider mode: critiques cannot provide independent authorship separation.'
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
    try {
      session.stage = 'preflight';
      this.store.save(session);
      await preflightProviders(
        this.gateway,
        this.store,
        session,
        session.config.providers,
        session.config.minProviders,
        'preflight',
        progress,
        signal
      );
      if (!session.config.interview) {
        this.completeInterview(session);
        return session;
      }
      return await this.runRound(session, context.packet, 1, progress, signal);
    } catch (error) {
      this.fail(session, error, signal);
      throw error;
    }
  }

  /** Record answers (`null` or blank skips a question). Never contacts a provider. */
  answer(sessionId: string | undefined, answers: ProposalAnswers): ProposalSession {
    const session = this.store.load(sessionId);
    if (session.stage !== 'awaiting-answers' && session.stage !== 'interview-complete') {
      throw new Error(`Session ${session.id} is not waiting for answers (stage ${session.stage})`);
    }
    const now = new Date().toISOString();
    for (const [id, value] of Object.entries(answers)) {
      const question = session.questions.find((item) => item.id === id.trim().toUpperCase());
      if (!question) throw new Error(`Unknown question: ${id}`);
      const text = value?.trim() ?? '';
      question.status = text ? 'answered' : 'skipped';
      question.answer = text || undefined;
      question.answeredAt = now;
    }
    if (openQuestions(session).length === 0 && interviewDone(session)) {
      this.completeInterview(session);
    } else {
      this.store.save(session);
    }
    return session;
  }

  /** Ask the council for another round; requires every open question answered or skipped. */
  async nextRound(
    sessionId: string | undefined,
    progress?: ResearchProgressHandler,
    signal?: AbortSignal
  ): Promise<ProposalSession> {
    const session = this.store.load(sessionId);
    if (session.stage !== 'awaiting-answers') {
      throw new Error(`Session ${session.id} is not in an interview (stage ${session.stage})`);
    }
    const open = openQuestions(session);
    if (open.length > 0) {
      throw new Error(
        `Answer or skip the open questions first: ${open.map((question) => question.id).join(', ')}`
      );
    }
    if (interviewDone(session)) {
      this.completeInterview(session);
      return session;
    }
    try {
      return await this.runRound(
        session,
        this.store.readContextPacket(session.id),
        currentRound(session) + 1,
        progress,
        signal
      );
    } catch (error) {
      this.fail(session, error, signal);
      throw error;
    }
  }

  /** End the interview now: open questions become skipped. Never contacts a provider. */
  finishInterview(sessionId?: string): ProposalSession {
    const session = this.store.load(sessionId);
    if (session.stage === 'interview-complete') return session;
    if (session.stage !== 'awaiting-answers') {
      throw new Error(`Session ${session.id} is not in an interview (stage ${session.stage})`);
    }
    const now = new Date().toISOString();
    for (const question of openQuestions(session)) {
      question.status = 'skipped';
      question.answeredAt = now;
    }
    this.completeInterview(session);
    return session;
  }

  /** Draft independently, critique blind, rank, and merge. Requires a completed interview. */
  async draft(
    sessionId: string | undefined,
    progress?: ResearchProgressHandler,
    signal?: AbortSignal
  ): Promise<ProposalSession> {
    const session = this.store.load(sessionId);
    if (session.stage === 'awaiting-answers') {
      throw new Error(
        'The interview is still open; answer the questions or finish it before drafting'
      );
    }
    if (session.stage !== 'interview-complete') {
      throw new Error(`Session ${session.id} cannot be drafted from stage ${session.stage}`);
    }
    return this.execute(session, this.store.readContextPacket(session.id), progress, signal);
  }

  /** Make one draft the proposal without a synthesis call. */
  pick(sessionId: string | undefined, draftId: string): ProposalSession {
    const session = this.store.load(sessionId);
    const draft = session.drafts.find((item) => item.id === draftId.trim().toUpperCase());
    if (!draft) {
      throw new Error(
        `Unknown draft: ${draftId} (available: ${session.drafts.map((item) => item.id).join(', ') || 'none'})`
      );
    }
    session.proposal = this.pickedProposal(draft, session);
    this.publish(session);
    return session;
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
    const selectedProvider = provider || session.providers[0] || session.config.providers[0];
    const members = session.providers.length > 0 ? session.providers : session.config.providers;
    if (!selectedProvider || !members.includes(selectedProvider)) {
      throw new Error(
        `Provider is not part of proposal ${session.id}: ${selectedProvider || 'none'}`
      );
    }
    const completion = await this.calls.invokeDetached(
      session.id,
      {
        id: `proposal-ask-${selectedProvider}-${Date.now()}`,
        stage: 'proposal-ask',
        provider: selectedProvider,
        subject: session.id,
        promptVersion: PROPOSAL_PROMPT_VERSIONS.ask,
        prompt: buildProposalAskPrompt(session, question, priorTurns, extraContext),
      },
      signal
    );
    return completion.content;
  }

  /** Continue a failed or interrupted session from its persisted stage. */
  async resume(
    sessionId?: string,
    progress?: ResearchProgressHandler,
    signal?: AbortSignal
  ): Promise<ProposalSession> {
    const session = this.store.load(sessionId);
    if (session.status === 'proposed' || session.status === 'completed') return session;
    session.error = undefined;
    try {
      switch (session.stage) {
        case 'created':
        case 'preflight':
        case 'interviewing': {
          session.status = 'running';
          session.stage = 'preflight';
          this.store.save(session);
          await preflightProviders(
            this.gateway,
            this.store,
            session,
            session.config.providers,
            session.config.minProviders,
            'preflight',
            progress,
            signal
          );
          if (!session.config.interview) {
            this.completeInterview(session);
            return session;
          }
          return await this.runRound(
            session,
            this.store.readContextPacket(session.id),
            currentRound(session) + 1,
            progress,
            signal
          );
        }
        case 'drafting':
        case 'critiquing':
        case 'synthesizing':
          return await this.execute(
            session,
            this.store.readContextPacket(session.id),
            progress,
            signal
          );
        case 'awaiting-answers':
        case 'interview-complete':
          session.status = 'waiting';
          this.store.save(session);
          return session;
        default:
          session.status = session.proposal ? 'proposed' : 'waiting';
          this.store.save(session);
          return session;
      }
    } catch (error) {
      this.fail(session, error, signal);
      throw error;
    }
  }

  private async prepare(
    input: ProposeInput,
    workingDirectory: string,
    signal?: AbortSignal
  ): Promise<{
    preview: ProposalPreview;
    context: BuiltContext;
    priorFindings?: ProposalSession['priorFindings'];
    seeded: { contextPaths: string[] };
  }> {
    const topic = input.topic.trim();
    if (!topic) throw new Error('A proposal topic is required');
    let council: ResearchSession | undefined;
    if (input.fromSessionId) {
      if (!this.options.councilStore) {
        throw new Error('Council sessions are not available to seed a proposal');
      }
      council = this.options.councilStore.load(input.fromSessionId);
    }
    const descriptors = await this.gateway.listProviders(workingDirectory, signal);
    const defaultProviders = descriptors.filter((provider) => provider.type === 'cli');
    const providers = [
      ...new Set(
        input.providers?.length
          ? input.providers
          : (defaultProviders.length > 0 ? defaultProviders : descriptors).map(
              (provider) => provider.name
            )
      ),
    ].sort();
    if (providers.length === 0) throw new Error('No Rubber Duck providers are configured');

    const minProviders = input.minProviders ?? Math.min(2, providers.length);
    const dials = dialConfigFrom(input.dials);
    const policy = resolveDialPolicy(dials);
    const contextBudget = calculateContextBudget(descriptors, providers, input.maxContextBytes);
    const contextPaths = input.contextPaths?.length
      ? input.contextPaths
      : (council?.config.contextPaths ?? []);
    const contextRoot = input.contextRoot || council?.config.contextRoot || process.cwd();
    const markdownOnly = input.markdownOnly ?? council?.config.markdownOnly ?? false;
    const context = buildContextPacket(contextPaths, contextBudget.maxBytes, contextRoot, {
      markdownOnly,
    });
    const interview = input.interview !== false;
    const maxRounds = Math.max(1, input.maxRounds ?? PROPOSAL_DEFAULTS.maxRounds);
    const mergeStrategy = input.mergeStrategy ?? 'synthesize';
    const priorFindings = council ? priorFindingsFrom(council) : undefined;
    return {
      context,
      priorFindings,
      seeded: { contextPaths },
      preview: {
        topic,
        providers,
        minProviders,
        maxRounds,
        interview,
        interviewVisibility: input.interviewVisibility ?? 'sealed',
        mergeStrategy,
        plannedCalls: planProposalCalls(providers.length, maxRounds, interview, mergeStrategy),
        contextManifest: context.manifest,
        contextBudget,
        contextRoot,
        markdownOnly,
        dials,
        policy,
        priorFindings: priorFindings?.length ?? 0,
        fromSessionId: council?.id,
      },
    };
  }

  /**
   * One interview round. Every prompt is built before any call is issued, so no provider's
   * questions can reach another provider's prompt within the round; in sealed mode a provider
   * only ever sees its own earlier questions and the person's answers to them.
   */
  private async runRound(
    session: ProposalSession,
    packet: string,
    round: number,
    progress: ResearchProgressHandler | undefined,
    signal: AbortSignal | undefined
  ): Promise<ProposalSession> {
    throwIfAborted(signal);
    const providers = activeInterviewers(session);
    session.status = 'running';
    session.stage = 'interviewing';
    this.store.save(session);
    const limit = session.config.maxQuestionsPerProvider;
    const specs = providers.map((provider) => ({
      provider,
      spec: {
        id: `interview-r${round}-${provider}`,
        stage: 'interview' as const,
        provider,
        subject: `round-${round}`,
        promptVersion: PROPOSAL_PROMPT_VERSIONS.interview,
        prompt: buildInterviewPrompt({
          session,
          provider,
          packet,
          visible: visibleQuestions(session, provider),
          round,
          limit,
        }),
      } satisfies CallSpec,
    }));
    let completed = 0;
    const results = await Promise.all(
      specs.map(async ({ provider, spec }): Promise<IncomingQuestions | undefined> => {
        await emitProgress(progress, 'interviewing', completed, specs.length, provider, {
          subject: provider,
          event: 'started',
        });
        try {
          const { parsed } = await this.calls.parseWithRepair(
            session,
            spec,
            InterviewOutputSchema,
            (raw) => ({
              ...spec,
              id: `${spec.id}-repair`,
              stage: 'interview-repair',
              promptVersion: PROPOSAL_PROMPT_VERSIONS.interviewRepair,
              prompt: buildInterviewRepairPrompt(raw),
            }),
            signal
          );
          completed++;
          await emitProgress(
            progress,
            'interviewing',
            completed,
            specs.length,
            `${provider}: ${parsed.questions.length} question${parsed.questions.length === 1 ? '' : 's'}`,
            { subject: provider, event: 'finished' }
          );
          return { provider, output: parsed };
        } catch (error) {
          throwIfAborted(signal);
          completed++;
          session.warnings.push(
            `Interview round ${round}: ${provider} failed: ${error instanceof Error ? error.message : String(error)}`
          );
          await emitProgress(
            progress,
            'interviewing',
            completed,
            specs.length,
            `${provider}: failed`,
            {
              subject: provider,
              event: 'finished',
            }
          );
          return undefined;
        }
      })
    );
    const incoming = results.filter((result): result is IncomingQuestions => !!result);
    if (incoming.length === 0 && specs.length > 0) {
      throw new Error(`Interview round ${round}: every provider failed`);
    }
    const questionIds = mergeQuestions(session, incoming, round);
    const record: InterviewRound = {
      round,
      askedProviders: providers,
      doneProviders: incoming
        .filter((result) => result.output.done === true || result.output.questions.length === 0)
        .map((result) => result.provider),
      questionIds,
      createdAt: new Date().toISOString(),
    };
    session.rounds.push(record);
    if (openQuestions(session).length === 0 && interviewDone(session)) {
      this.completeInterview(session);
    } else {
      session.stage = 'awaiting-answers';
      session.status = 'waiting';
      this.store.save(session);
    }
    return session;
  }

  private completeInterview(session: ProposalSession): void {
    session.stage = 'interview-complete';
    session.status = 'waiting';
    session.transcriptPath = this.store.writeReport(
      session.id,
      'transcript.md',
      renderTranscriptMarkdown(session)
    );
    this.store.save(session);
  }

  private async execute(
    session: ProposalSession,
    packet: string,
    progress: ResearchProgressHandler | undefined,
    signal: AbortSignal | undefined
  ): Promise<ProposalSession> {
    try {
      session.status = 'running';
      session.error = undefined;
      await this.draftAll(session, packet, progress, signal);
      await this.critiqueAll(session, progress, signal);
      session.drafts = rankDrafts(session.drafts, session.critiques).sort((left, right) =>
        left.id.localeCompare(right.id)
      );
      this.store.save(session);
      await this.merge(session, progress, signal);
      this.publish(session);
      return session;
    } catch (error) {
      this.fail(session, error, signal);
      throw error;
    }
  }

  private draftId(session: ProposalSession, provider: string): string {
    const index = [...session.config.providers].sort().indexOf(provider);
    return `D-${String(index + 1).padStart(3, '0')}`;
  }

  /** Sealed drafting: the same prompt to every provider that has no draft yet, in parallel. */
  private async draftAll(
    session: ProposalSession,
    packet: string,
    progress: ResearchProgressHandler | undefined,
    signal: AbortSignal | undefined
  ): Promise<void> {
    throwIfAborted(signal);
    session.stage = 'drafting';
    this.store.save(session);
    const pending = session.providers.filter(
      (provider) => !session.drafts.some((draft) => draft.authorProvider === provider)
    );
    const prompt = buildProposalDraftPrompt(session, packet);
    const specs = pending.map((provider) => ({
      provider,
      spec: {
        id: `draft-${provider}`,
        stage: 'proposal-draft' as const,
        provider,
        subject: this.draftId(session, provider),
        promptVersion: PROPOSAL_PROMPT_VERSIONS.draft,
        prompt,
      } satisfies CallSpec,
    }));
    let completed = 0;
    await Promise.all(
      specs.map(async ({ provider, spec }) => {
        await emitProgress(progress, 'drafting', completed, specs.length, provider, {
          subject: provider,
          event: 'started',
        });
        try {
          const { parsed, completion } = await this.calls.parseWithRepair(
            session,
            spec,
            ProposalDraftOutputSchema,
            (raw) => ({
              ...spec,
              id: `${spec.id}-repair`,
              stage: 'proposal-draft-repair',
              promptVersion: PROPOSAL_PROMPT_VERSIONS.draftRepair,
              prompt: buildProposalDraftRepairPrompt(raw),
            }),
            signal
          );
          const draft: ProposalDraft = {
            ...parsed,
            id: this.draftId(session, provider),
            authorProvider: provider,
            authorModel: completion.model,
            createdAt: new Date().toISOString(),
          };
          session.drafts = [...session.drafts, draft].sort((a, b) => a.id.localeCompare(b.id));
          this.store.save(session);
          completed++;
          await emitProgress(
            progress,
            'drafting',
            completed,
            specs.length,
            `${provider}: ${draft.title}`,
            {
              subject: provider,
              event: 'finished',
            }
          );
        } catch (error) {
          throwIfAborted(signal);
          completed++;
          session.warnings.push(
            `Draft from ${provider} failed: ${error instanceof Error ? error.message : String(error)}`
          );
          await emitProgress(progress, 'drafting', completed, specs.length, `${provider}: failed`, {
            subject: provider,
            event: 'finished',
          });
        }
      })
    );
    if (session.drafts.length === 0) throw new Error('No provider produced a proposal draft');
  }

  /** Blind critique: each draft goes to a non-author (seed + 2 rotates away from council review). */
  private async critiqueAll(
    session: ProposalSession,
    progress: ResearchProgressHandler | undefined,
    signal: AbortSignal | undefined
  ): Promise<void> {
    throwIfAborted(signal);
    session.stage = 'critiquing';
    this.store.save(session);
    const assignments = assignReviewers(session.drafts, session.providers, session.config.seed + 2);
    const pending = session.drafts.filter(
      (draft) => !session.critiques.some((critique) => critique.draftId === draft.id)
    );
    const specs = pending.map((draft) => {
      const reviewer = assignments.get(draft.id) ?? draft.authorProvider;
      return {
        draft,
        reviewer,
        spec: {
          id: `critique-${draft.id}`,
          stage: 'proposal-critique' as const,
          provider: reviewer,
          subject: draft.id,
          promptVersion: PROPOSAL_PROMPT_VERSIONS.critique,
          prompt: buildProposalCritiquePrompt(session, draft),
        } satisfies CallSpec,
      };
    });
    let completed = 0;
    await Promise.all(
      specs.map(async ({ draft, reviewer, spec }) => {
        await emitProgress(progress, 'critiquing', completed, specs.length, draft.id, {
          subject: draft.id,
          event: 'started',
        });
        try {
          const { parsed } = await this.calls.parseWithRepair(
            session,
            spec,
            ProposalCritiqueOutputSchema,
            (raw) => ({
              ...spec,
              id: `${spec.id}-repair`,
              stage: 'proposal-critique-repair',
              promptVersion: PROPOSAL_PROMPT_VERSIONS.critiqueRepair,
              prompt: buildProposalCritiqueRepairPrompt(raw),
            }),
            signal
          );
          session.critiques = [
            ...session.critiques,
            {
              ...parsed,
              id: `PC-${draft.id}`,
              draftId: draft.id,
              reviewerProvider: reviewer,
              selfReview: reviewer === draft.authorProvider,
              createdAt: new Date().toISOString(),
            },
          ].sort((a, b) => a.id.localeCompare(b.id));
          this.store.save(session);
          completed++;
          await emitProgress(
            progress,
            'critiquing',
            completed,
            specs.length,
            `${draft.id}: ${parsed.verdict}`,
            {
              subject: draft.id,
              event: 'finished',
            }
          );
        } catch (error) {
          throwIfAborted(signal);
          completed++;
          session.warnings.push(
            `Critique of ${draft.id} failed: ${error instanceof Error ? error.message : String(error)}`
          );
          await emitProgress(
            progress,
            'critiquing',
            completed,
            specs.length,
            `${draft.id}: failed`,
            {
              subject: draft.id,
              event: 'finished',
            }
          );
        }
      })
    );
    if (session.critiques.some((critique) => critique.selfReview)) {
      session.warnings.push(
        'Some drafts were critiqued by their own author (not enough providers).'
      );
    }
  }

  private pickedProposal(draft: ProposalDraft, session: ProposalSession): MergedProposal {
    const {
      id: _id,
      authorProvider: _author,
      authorModel: _model,
      rank: _rank,
      score: _score,
      createdAt: _created,
      ...body
    } = draft;
    return {
      ...body,
      source: 'picked',
      sourceDraftId: draft.id,
      alternatives: session.drafts
        .filter((other) => other.id !== draft.id)
        .map((other) => `${other.id}: ${other.title}`),
      createdAt: new Date().toISOString(),
    };
  }

  /** Synthesis by one seeded provider over the public ranked drafts; falls back to the top draft. */
  private async merge(
    session: ProposalSession,
    progress: ResearchProgressHandler | undefined,
    signal: AbortSignal | undefined
  ): Promise<void> {
    throwIfAborted(signal);
    const ranked = rankedDrafts(session);
    const top = ranked[0];
    if (!top) throw new Error('No proposal draft to merge');
    if (session.config.mergeStrategy === 'pick' || ranked.length === 1) {
      session.proposal = this.pickedProposal(top, session);
      return;
    }
    session.stage = 'synthesizing';
    this.store.save(session);
    const members = [...session.providers].sort();
    const synthesizer =
      members[stableHash(`${session.config.seed}:synthesis:${session.id}`) % members.length];
    const spec: CallSpec = {
      id: 'synthesis',
      stage: 'proposal-synthesis',
      provider: synthesizer,
      subject: 'proposal',
      promptVersion: PROPOSAL_PROMPT_VERSIONS.synthesis,
      prompt: buildProposalSynthesisPrompt(session, ranked, session.critiques),
    };
    await emitProgress(progress, 'synthesizing', 0, 1, 'merging drafts', {
      subject: 'proposal',
      event: 'started',
    });
    try {
      const { parsed, completion } = await this.calls.parseWithRepair(
        session,
        spec,
        MergedProposalOutputSchema,
        (raw) => ({
          ...spec,
          id: 'synthesis-repair',
          stage: 'proposal-synthesis-repair',
          promptVersion: PROPOSAL_PROMPT_VERSIONS.synthesisRepair,
          prompt: buildProposalSynthesisRepairPrompt(raw),
        }),
        signal
      );
      session.proposal = {
        ...parsed,
        source: 'synthesized',
        synthesizerProvider: synthesizer,
        synthesizerModel: completion.model,
        createdAt: new Date().toISOString(),
      };
      await emitProgress(progress, 'synthesizing', 1, 1, parsed.title, {
        subject: 'proposal',
        event: 'finished',
      });
    } catch (error) {
      throwIfAborted(signal);
      session.warnings.push(
        `Synthesis failed (${error instanceof Error ? error.message : String(error)}); the top-ranked draft was picked instead.`
      );
      session.proposal = this.pickedProposal(top, session);
      await emitProgress(progress, 'synthesizing', 1, 1, `failed; picked ${top.id}`, {
        subject: 'proposal',
        event: 'finished',
      });
    }
  }

  private publish(session: ProposalSession): void {
    session.stage = 'proposed';
    session.status = 'proposed';
    session.error = undefined;
    session.transcriptPath = this.store.writeReport(
      session.id,
      'transcript.md',
      renderTranscriptMarkdown(session)
    );
    session.proposalMarkdownPath = this.store.writeReport(
      session.id,
      'proposal.md',
      renderProposalMarkdown(session)
    );
    session.proposalJsonPath = this.store.writeReport(
      session.id,
      'proposal.json',
      JSON.stringify(createPublicProposalReport(session), null, 2)
    );
    this.store.save(session);
  }

  private fail(session: ProposalSession, error: unknown, signal?: AbortSignal): void {
    session.status = signal?.aborted ? 'interrupted' : 'failed';
    session.error = error instanceof Error ? error.message : String(error);
    this.store.save(session);
  }
}
