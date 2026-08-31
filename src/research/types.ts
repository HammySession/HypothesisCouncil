import type {
  FalsificationOutput,
  GeneratedHypothesis,
  HypothesisEvidence,
  KillCriterionAssessment,
  ReviewOutput,
} from './schemas.js';

export type ResearchStage =
  | 'created'
  | 'preflight'
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
}

export interface HypothesisCandidate
  extends Omit<GeneratedHypothesis, 'differsFromConsensus' | 'evidence'> {
  id: string;
  sessionId: string;
  generationIndex: number;
  authorProvider: string;
  authorModel?: string;
  /** Absent on sessions persisted before the falsifiability/provenance upgrade. */
  differsFromConsensus?: string;
  /** Absent on sessions persisted before the falsifiability/provenance upgrade. */
  evidence?: VerifiedEvidence[];
  status: 'distinct' | 'duplicate';
  duplicateOf?: string;
  score?: number;
  rank?: number;
  createdAt: string;
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
    | 'generation-repair'
    | 'review'
    | 'review-repair'
    | 'falsification'
    | 'falsification-repair'
    | 'ask';
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
}

export interface ResearchSession {
  version: 1;
  id: string;
  goal: string;
  status: ResearchStatus;
  stage: ResearchStage;
  createdAt: string;
  updatedAt: string;
  config: ResearchConfig;
  providers: string[];
  unavailableProviders: string[];
  contextManifest: ContextManifest;
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
}

export interface PlannedProviderCalls {
  generation: number;
  review: number;
  falsification: number;
  total: number;
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
}

export type ResearchRunApproval = (preview: ResearchRunPreview) => void | Promise<void>;

export interface ResearchProgress {
  stage: ResearchStage;
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
