import type { ResearchSession } from '../types.js';
import { rankedDrafts } from './interview.js';
import type {
  InterviewQuestion,
  MergedProposal,
  PriorFinding,
  ProposalCritique,
  ProposalDraft,
  ProposalSession,
} from './types.js';

/** Question without the providers that asked it. */
export function publicQuestion(question: InterviewQuestion): Record<string, unknown> {
  const { sources: _sources, ...visible } = question;
  return visible;
}

export function publicDraft(draft: ProposalDraft): Record<string, unknown> {
  const { authorProvider: _author, authorModel: _model, ...visible } = draft;
  return visible;
}

export function publicCritique(critique: ProposalCritique): Record<string, unknown> {
  const { reviewerProvider: _reviewer, ...visible } = critique;
  return visible;
}

export function publicProposal(proposal: MergedProposal): Record<string, unknown> {
  const { synthesizerProvider: _synthesizer, synthesizerModel: _model, ...visible } = proposal;
  return visible;
}

/** Council candidates projected through the public candidate shape; nothing names a provider. */
export function priorFindingsFrom(session: ResearchSession): PriorFinding[] {
  return session.candidates
    .filter((candidate) => candidate.status === 'distinct')
    .sort((left, right) => (left.rank || 999) - (right.rank || 999))
    .map((candidate) => ({
      id: candidate.id,
      rank: candidate.rank,
      title: candidate.title,
      claim: candidate.claim,
      mechanism: candidate.mechanism,
      predictions: candidate.predictions,
      falsifier: candidate.falsifier,
      minimalExperiment: candidate.minimalExperiment,
      reviewVerdict: session.reviews.find((review) => review.hypothesisId === candidate.id)
        ?.verdict,
    }));
}

export function publicProposalSnapshot(session: ProposalSession): Record<string, unknown> {
  return {
    kind: session.kind,
    id: session.id,
    topic: session.topic,
    meta: session.meta,
    status: session.status,
    stage: session.stage,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    config: session.config,
    providers: session.providers,
    unavailableProviders: session.unavailableProviders,
    contextManifest: session.contextManifest,
    priorFindings: session.priorFindings,
    questions: session.questions.map(publicQuestion),
    rounds: session.rounds.map(({ askedProviders, doneProviders, ...round }) => ({
      ...round,
      askedCount: askedProviders.length,
      doneCount: doneProviders.length,
    })),
    drafts: rankedDrafts(session).map(publicDraft),
    critiques: session.critiques.map(publicCritique),
    proposal: session.proposal ? publicProposal(session.proposal) : undefined,
    handoffs: session.handoffs,
    progress: {
      providerCallsCompleted: session.calls.filter((call) => call.success).length,
      providerCallsFailed: session.calls.filter((call) => !call.success).length,
    },
    warnings: session.warnings,
    transcriptPath: session.transcriptPath,
    proposalMarkdownPath: session.proposalMarkdownPath,
    proposalJsonPath: session.proposalJsonPath,
    error: session.error,
  };
}

export function createPublicProposalReport(session: ProposalSession): Record<string, unknown> {
  return {
    kind: 'proposal',
    sessionId: session.id,
    topic: session.topic,
    status: session.status,
    generatedAt: session.updatedAt,
    configuration: session.config,
    context: session.contextManifest,
    fromSessionId: session.config.fromSessionId,
    priorFindings: session.priorFindings ?? [],
    interview: session.questions.map(publicQuestion),
    proposal: session.proposal ? publicProposal(session.proposal) : null,
    drafts: rankedDrafts(session).map((draft) => ({
      ...publicDraft(draft),
      critique: session.critiques
        .filter((critique) => critique.draftId === draft.id)
        .map(publicCritique),
    })),
    handoffs: session.handoffs,
    warnings: session.warnings,
    methodNotes: [
      'Interview questions were generated independently per provider and merged by lexical similarity; in sealed mode no provider saw the questions of another provider.',
      'Drafts were written independently from the same transcript and context; critiques hid author labels and never came from the author.',
      'The merged proposal is a synthesis (or a pick) over public drafts and critiques; dissenting designs are kept as alternatives rather than discarded.',
      'Prior council findings, when present, were inputs to build on or refute, not conclusions.',
    ],
  };
}
