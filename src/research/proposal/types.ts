import type { DialPolicy } from '../dials.js';
import type { DialConfig, DialInput } from '../settings.js';
import type {
  ContextBudgetPlan,
  ContextManifest,
  ProviderCallRecord,
  SessionMeta,
} from '../types.js';
import type {
  ExperimentStep,
  InterviewQuestionOutput,
  ProposalCritiqueOutput,
  ProposalDraftOutput,
} from './schemas.js';

/**
 * Research proposal mode: the council interviews the person, drafts proposals independently,
 * critiques them blind, and merges them into one plan that a single executor can carry out.
 * Everything with `authorProvider`, `reviewerProvider`, `synthesizerProvider`, or `sources`
 * is private; the public projections in `public.ts` strip them.
 */

export type ProposalStage =
  | 'created'
  | 'preflight'
  | 'interviewing'
  | 'awaiting-answers'
  | 'interview-complete'
  | 'drafting'
  | 'critiquing'
  | 'synthesizing'
  | 'proposed'
  | 'handoff-prepared'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'interrupted';

/** `waiting` means the session is waiting on the person: for answers or for the draft command. */
export type ProposalStatus =
  | 'running'
  | 'waiting'
  | 'proposed'
  | 'completed'
  | 'failed'
  | 'interrupted';

export type InterviewVisibility = 'sealed' | 'visible';
export type MergeStrategy = 'synthesize' | 'pick';

export interface ProposalConfig {
  providers: string[];
  minProviders: number;
  seed: number;
  maxRounds: number;
  maxQuestionsPerProvider: number;
  maxQuestionsPerRound: number;
  interviewVisibility: InterviewVisibility;
  mergeStrategy: MergeStrategy;
  /** Whether the council interviews the person before drafting. */
  interview: boolean;
  dials: DialConfig;
  policy: DialPolicy;
  /** Council session whose ranked findings seeded this proposal. */
  fromSessionId?: string;
  contextPaths: string[];
  contextRoot: string;
  markdownOnly: boolean;
  maxContextBytes: number;
  contextBudget: ContextBudgetPlan;
}

export type QuestionStatus = 'open' | 'answered' | 'skipped' | 'auto-resolved';

export interface InterviewQuestion extends InterviewQuestionOutput {
  /** `Q-001`, assigned in merge order and never reused. */
  id: string;
  round: number;
  /** Providers that asked this or a near-duplicate; private. */
  sources: string[];
  askedByCount: number;
  status: QuestionStatus;
  answer?: string;
  /** Id of the earlier question whose answer resolved this one. */
  resolvedBy?: string;
  answeredAt?: string;
}

export interface InterviewRound {
  round: number;
  askedProviders: string[];
  /** Providers that declared they had nothing further to ask. */
  doneProviders: string[];
  questionIds: string[];
  createdAt: string;
}

export interface ProposalDraft extends ProposalDraftOutput {
  /** `D-001`, assigned by sorted provider name. */
  id: string;
  authorProvider: string;
  authorModel?: string;
  rank?: number;
  score?: number;
  createdAt: string;
}

export interface ProposalCritique extends ProposalCritiqueOutput {
  id: string;
  draftId: string;
  reviewerProvider: string;
  selfReview: boolean;
  createdAt: string;
}

export interface MergedProposal extends ProposalDraftOutput {
  source: 'synthesized' | 'picked';
  sourceDraftId?: string;
  synthesizerProvider?: string;
  synthesizerModel?: string;
  rationale?: string;
  /** Dissenting designs the synthesis kept as alternatives. */
  alternatives: string[];
  createdAt: string;
}

export type HandoffTransport = 'prompt-only' | 'spawned';

export type HandoffStatus = 'prepared' | 'running' | 'completed' | 'failed' | 'interrupted';

export interface HandoffExecutor {
  profile: string;
  command?: string;
  args?: string[];
  model?: string;
  promptDelivery?: 'stdin' | 'argument' | 'prompt-file';
  mode?: 'full-auto' | 'sandboxed';
}

export interface HandoffRecord {
  /** `X-001`. */
  id: string;
  executor: HandoffExecutor;
  repositoryPath: string;
  transport: HandoffTransport;
  promptPath: string;
  logPath?: string;
  resultPath?: string;
  status: HandoffStatus;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  error?: string;
}

/** A council finding projected through the public candidate shape; no author or reviewer. */
export interface PriorFinding {
  id: string;
  rank?: number;
  title: string;
  claim: string;
  mechanism: string;
  predictions: string[];
  falsifier: string;
  minimalExperiment: string;
  reviewVerdict?: string;
}

export interface ProposalSession {
  version: 1;
  kind: 'proposal';
  id: string;
  topic: string;
  meta?: SessionMeta;
  status: ProposalStatus;
  stage: ProposalStage;
  createdAt: string;
  updatedAt: string;
  config: ProposalConfig;
  providers: string[];
  unavailableProviders: string[];
  contextManifest: ContextManifest;
  priorFindings?: PriorFinding[];
  questions: InterviewQuestion[];
  rounds: InterviewRound[];
  drafts: ProposalDraft[];
  critiques: ProposalCritique[];
  proposal?: MergedProposal;
  handoffs: HandoffRecord[];
  calls: ProviderCallRecord[];
  warnings: string[];
  transcriptPath?: string;
  proposalMarkdownPath?: string;
  proposalJsonPath?: string;
  error?: string;
}

export interface ProposeInput {
  topic: string;
  providers?: string[];
  contextPaths?: string[];
  contextRoot?: string;
  markdownOnly?: boolean;
  maxContextBytes?: number;
  minProviders?: number;
  seed?: number;
  maxRounds?: number;
  maxQuestionsPerProvider?: number;
  maxQuestionsPerRound?: number;
  interviewVisibility?: InterviewVisibility;
  mergeStrategy?: MergeStrategy;
  /** `false` skips the interview and drafts from the topic and context alone. */
  interview?: boolean;
  dials?: DialInput;
  fromSessionId?: string;
  meta?: SessionMeta;
}

export interface PlannedProposalCalls {
  /** Upper bound: every provider in every round. */
  interview: number;
  drafts: number;
  critiques: number;
  synthesis: number;
  total: number;
}

export interface ProposalPreview {
  topic: string;
  providers: string[];
  minProviders: number;
  maxRounds: number;
  interview: boolean;
  interviewVisibility: InterviewVisibility;
  mergeStrategy: MergeStrategy;
  plannedCalls: PlannedProposalCalls;
  contextManifest: ContextManifest;
  contextBudget: ContextBudgetPlan;
  contextRoot: string;
  markdownOnly: boolean;
  dials: DialConfig;
  policy: DialPolicy;
  priorFindings: number;
  fromSessionId?: string;
}

export type ProposalApproval = (preview: ProposalPreview) => void | Promise<void>;

export interface ProposalNextAction {
  kind: 'answer' | 'next-round' | 'draft' | 'resume' | 'pick' | 'handoff' | 'done';
  openQuestions: number;
  round: number;
  message: string;
}

export type { ExperimentStep };
