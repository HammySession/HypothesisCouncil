import type { DialPolicy, SourceVerificationMode } from './dials.js';
import type { ProposalStage } from './proposal/types.js';
import type {
  FalsificationOutput,
  GeneratedHypothesis,
  HypothesisEvidence,
  KillCriterionAssessment,
  ReviewOutput,
} from './schemas.js';
import type { DialConfig, DialInput } from './settings.js';
import type { SourceRecord, SourceReplication } from './sources.js';

export type { DialPolicy } from './dials.js';
export type {
  SourceCritiqueRecord,
  SourceKind,
  SourceOrigin,
  SourceRecord,
  SourceReplication,
  SourceVerificationRecord,
  SourceVerificationStatus,
} from './sources.js';
export type { DialConfig, DialInput, DialSettings, SettingOrigin } from './settings.js';

export type ResearchStage =
  | 'created'
  | 'preflight'
  | 'sourcing'
  | 'generating'
  | 'deduplicating'
  | 'reviewing'
  | 'falsifying'
  | 'reporting'
  | 'completed'
  | 'failed'
  | 'interrupted';

export type ResearchStatus = 'running' | 'completed' | 'failed' | 'interrupted';

export interface ContextFileRecord {
  path: string;
  bytes: number;
  sha256: string;
  includedBytes: number;
  truncated: boolean;
}

export interface ContextManifest {
  files: ContextFileRecord[];
  deniedPaths: string[];
  omittedPaths: string[];
  /**
   * Requested `--context` paths or glob patterns that selected zero eligible files. Always present
   * on newly built manifests; absent in sessions persisted before the field existed.
   */
  unmatchedRequestedPaths?: string[];
  totalBytes: number;
  includedBytes: number;
  packetBytes: number;
  maxBytes: number;
  packetSha256: string;
  /** Bytes held back from files for the SOURCES appendix; absent when no sources stage runs. */
  reservedBytes?: number;
  /** Bytes the SOURCES appendix occupies once it has been added to the packet. */
  appendixBytes?: number;
}

export interface ProviderContextLimit {
  provider: string;
  model: string;
  contextWindowTokens: number;
  reservedOutputTokens: number;
  maxContextBytes: number;
  source: 'model' | 'provider-default' | 'configured-override';
  transportLimited: boolean;
}

export interface ContextBudgetPlan {
  maxBytes: number;
  limitingProvider: string;
  requestedMaxBytes?: number;
  providerLimits: ProviderContextLimit[];
}

export type EvidenceVerification = 'verified' | 'unverified' | 'not-applicable';

/**
 * A generation-time evidence entry after the deterministic packet check. `verification` is
 * `verified` when a `context` entry's quote was found verbatim (modulo whitespace and case) in the
 * shared context packet, `unverified` when it was not, and `not-applicable` for entries whose
 * declared basis is general knowledge or speculation.
 */
export interface VerifiedEvidence extends HypothesisEvidence {
  verification: EvidenceVerification;
  /** Copied from the cited source's critique so reviewers see the grade without the grader. */
  reliability?: number;
  replication?: SourceReplication;
  concerns?: string[];
}

export interface HypothesisCandidate extends Omit<
  GeneratedHypothesis,
  'differsFromConsensus' | 'evidence'
> {
  id: string;
  sessionId: string;
  generationIndex: number;
  authorProvider: string;
  authorModel?: string;
  /** Absent on sessions persisted before the falsifiability/provenance upgrade. */
  differsFromConsensus?: string;
  /** Absent on sessions persisted before the falsifiability/provenance upgrade. */
  evidence?: VerifiedEvidence[];
  /** Which sealed generation batch produced the candidate; absent before the dials existed. */
  variant?: 'standard' | 'out-of-box';
  status: 'distinct' | 'duplicate';
  duplicateOf?: string;
  score?: number;
  /** Points the dial policy subtracted from the review aggregate; present only when non-zero. */
  scorePenalties?: ScorePenalties;
  rank?: number;
  createdAt: string;
}

export interface ScorePenalties {
  crowding?: number;
  unsupportedEvidence?: number;
}

export interface HypothesisReview extends Omit<ReviewOutput, 'killCriterion'> {
  id: string;
  sessionId: string;
  hypothesisId: string;
  reviewerProvider: string;
  selfReview: boolean;
  /** Absent on sessions persisted before the falsifiability/provenance upgrade. */
  killCriterion?: KillCriterionAssessment;
  createdAt: string;
}

export interface HypothesisFalsification extends FalsificationOutput {
  id: string;
  sessionId: string;
  hypothesisId: string;
  reviewerProvider: string;
  /** Adversarial round (1 when absent); high skepticism runs a second independent round. */
  round?: number;
  createdAt: string;
}

export interface ConsensusCrowdingCluster {
  candidateIds: string[];
  /** Number of distinct providers that converged on this cluster; never names them. */
  providerCount: number;
}

/**
 * Cross-provider convergence among the independently generated batches. Agreement between models
 * that share training literature is consensus recall, not independent replication, so crowding is
 * reported as a caution and never raises a candidate's rank.
 */
export interface ConsensusCrowding {
  similarityThreshold: number;
  clusters: ConsensusCrowdingCluster[];
  crowdedCandidateIds: string[];
  /** Crowded candidates over all generated candidates; 0 when generation produced none. */
  crowdingRatio: number;
}

export interface ProviderCallRecord {
  id: string;
  stage:
    | 'generation'
    | 'generation-outofbox'
    | 'generation-repair'
    | 'review'
    | 'review-repair'
    | 'falsification'
    | 'falsification-repair'
    | 'source-scout'
    | 'source-scout-repair'
    | 'source-critique'
    | 'source-critique-repair'
    | 'ask'
    | 'interview'
    | 'interview-repair'
    | 'proposal-draft'
    | 'proposal-draft-repair'
    | 'proposal-critique'
    | 'proposal-critique-repair'
    | 'proposal-synthesis'
    | 'proposal-synthesis-repair'
    | 'proposal-ask';
  provider: string;
  subject: string;
  promptVersion: string;
  startedAt: string;
  endedAt: string;
  success: boolean;
  rawPath?: string;
  parsedPath?: string;
  error?: string;
}

export interface ResearchConfig {
  providers: string[];
  hypothesesPerProvider: number;
  topK: number;
  minProviders: number;
  seed: number;
  maxContextBytes: number;
  contextPaths: string[];
  contextRoot: string;
  markdownOnly: boolean;
  contextBudget: ContextBudgetPlan;
  /** Dial values with origins; absent on sessions persisted before the dials existed. */
  dials?: DialConfig;
  /** The policy derived from the dials at run time; absent on pre-dial sessions. */
  policy?: DialPolicy;
  /** Sources stage settings; absent when the run cites nothing beyond the file packet. */
  sources?: SourcesConfig;
}

export type WebAccess = 'on' | 'off';

/** How the sources stage was configured for a session. */
export interface SourcesConfig {
  /** Path of the person's sources file relative to the context root, when one was given. */
  sourcesFile?: string;
  /** Web scout providers that proposed sources; never council members. */
  scouts: string[];
  web: WebAccess;
  verification: SourceVerificationMode;
  sourcesPerScout: number;
  rounds: number;
  critique: boolean;
}

/** User-facing annotations on a session; editable without re-running anything. */
export interface SessionMeta {
  title?: string;
  tags?: string[];
  summary?: string;
  /** Council preset the session was started with, when one was used. */
  preset?: string;
}

export interface ResearchSession {
  version: 1;
  id: string;
  goal: string;
  meta?: SessionMeta;
  status: ResearchStatus;
  stage: ResearchStage;
  createdAt: string;
  updatedAt: string;
  config: ResearchConfig;
  providers: string[];
  unavailableProviders: string[];
  contextManifest: ContextManifest;
  /** Source records the packet cites; user-supplied ones are present from the start. */
  sources?: SourceRecord[];
  /** Set once the sources stage has verified, critiqued, and appended the records. */
  sourcesCompletedAt?: string;
  candidates: HypothesisCandidate[];
  /** Absent on sessions persisted before the falsifiability/provenance upgrade. */
  consensusCrowding?: ConsensusCrowding;
  reviews: HypothesisReview[];
  falsifications: HypothesisFalsification[];
  calls: ProviderCallRecord[];
  warnings: string[];
  reportMarkdownPath?: string;
  reportJsonPath?: string;
  error?: string;
}

export interface RunResearchInput {
  goal: string;
  providers?: string[];
  contextPaths?: string[];
  hypothesesPerProvider?: number;
  topK?: number;
  minProviders?: number;
  seed?: number;
  maxContextBytes?: number;
  contextRoot?: string;
  markdownOnly?: boolean;
  /** Novelty and skepticism levels; missing values use the default level 5. */
  dials?: DialInput;
  /** Sources file (JSON or Markdown) relative to the context root. */
  sourcesFile?: string;
  /** Scout providers; defaults to every configured provider named `*-scout` or `*_scout`. */
  scouts?: string[];
  /** `off` disables scouting and URL fetching entirely. Defaults to `on` when scouts exist. */
  web?: WebAccess;
  /** Copied onto the session as-is. */
  meta?: SessionMeta;
}

export interface PlannedProviderCalls {
  generation: number;
  /** Extra sealed out-of-the-box generation calls (high novelty only). */
  outOfBox: number;
  review: number;
  falsification: number;
  falsificationRounds: number;
  /** Scout and source-critique calls; present only when a sources stage is planned. */
  sourcing?: number;
  total: number;
}

export interface SourcesPlan {
  sourcesFile?: string;
  userSources: number;
  scouts: string[];
  web: WebAccess;
  rounds: number;
  sourcesPerScout: number;
  verification: SourceVerificationMode;
  critique: boolean;
  /** Bytes of the shared budget held back for the SOURCES appendix. */
  reservedBytes: number;
}

export interface ResearchRunPreview {
  goal: string;
  providers: string[];
  minProviders: number;
  hypothesesPerProvider: number;
  topK: number;
  plannedCalls: PlannedProviderCalls;
  contextManifest: ContextManifest;
  contextBudget: ContextBudgetPlan;
  contextRoot: string;
  markdownOnly: boolean;
  dials: DialConfig;
  policy: DialPolicy;
  /** Present when the run will cite sources (a sources file or at least one scout). */
  sourcesPlan?: SourcesPlan;
}

export type ResearchRunApproval = (preview: ResearchRunPreview) => void | Promise<void>;

export interface ResearchProgress {
  /** Council stage, or a proposal stage when a proposal session reports progress. */
  stage: ResearchStage | ProposalStage;
  completed: number;
  total: number;
  message: string;
  /**
   * The unit of work this event describes: a provider name during preflight and generation, or a
   * candidate id during review and falsification. Reviewer identities are never exposed here.
   */
  subject?: string;
  event?: 'started' | 'finished';
}

export type ResearchProgressHandler = (progress: ResearchProgress) => void | Promise<void>;

export interface ProviderDescriptor {
  name: string;
  nickname: string;
  model: string;
  type: 'http' | 'cli' | 'unknown';
}

export interface ResearchCompletion {
  content: string;
  model: string;
}

export interface ResearchCompletionOptions {
  workingDirectory: string;
  signal?: AbortSignal;
}

export interface ResearchProviderGateway {
  listProviders(workingDirectory: string, signal?: AbortSignal): Promise<ProviderDescriptor[]>;
  healthCheck(provider: string, workingDirectory: string, signal?: AbortSignal): Promise<boolean>;
  complete(
    provider: string,
    prompt: string,
    options: ResearchCompletionOptions
  ): Promise<ResearchCompletion>;
  close(): Promise<void>;
}
