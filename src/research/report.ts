import { describeEvidence, lacksVerifiedContextEvidence } from './evidence.js';
import type { HypothesisCandidate, ResearchSession } from './types.js';

function rankedCandidates(session: ResearchSession): HypothesisCandidate[] {
  return session.candidates
    .filter((candidate) => candidate.status === 'distinct')
    .sort((left, right) => (left.rank || 999) - (right.rank || 999));
}

export function publicCandidateRecord(candidate: HypothesisCandidate): Record<string, unknown> {
  const { authorProvider: _author, authorModel: _model, ...visible } = candidate;
  return visible;
}

export function publicSessionSnapshot(session: ResearchSession): Record<string, unknown> {
  return {
    id: session.id,
    goal: session.goal,
    status: session.status,
    stage: session.stage,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    config: session.config,
    providers: session.providers,
    unavailableProviders: session.unavailableProviders,
    contextManifest: session.contextManifest,
    candidates: session.candidates.map(publicCandidateRecord),
    consensusCrowding: session.consensusCrowding,
    reviews: session.reviews.map(({ reviewerProvider: _reviewer, ...review }) => review),
    falsifications: session.falsifications.map(
      ({ reviewerProvider: _reviewer, ...attack }) => attack
    ),
    progress: {
      providerCallsCompleted: session.calls.filter((call) => call.success).length,
      providerCallsFailed: session.calls.filter((call) => !call.success).length,
    },
    warnings: session.warnings,
    reportMarkdownPath: session.reportMarkdownPath,
    reportJsonPath: session.reportJsonPath,
    error: session.error,
  };
}

export function createPublicReport(session: ResearchSession): Record<string, unknown> {
  return {
    sessionId: session.id,
    goal: session.goal,
    status: session.status,
    generatedAt: session.updatedAt,
    configuration: session.config,
    context: session.contextManifest,
    warnings: session.warnings,
    candidates: rankedCandidates(session).map((candidate) => ({
      ...publicCandidateRecord(candidate),
      review: session.reviews
        .filter((review) => review.hypothesisId === candidate.id)
        .map(({ reviewerProvider: _reviewer, ...review }) => review),
      falsification: session.falsifications
        .filter((attack) => attack.hypothesisId === candidate.id)
        .map(({ reviewerProvider: _reviewer, ...attack }) => attack),
    })),
    duplicates: session.candidates
      .filter((candidate) => candidate.status === 'duplicate')
      .map(publicCandidateRecord),
    consensusCrowding: session.consensusCrowding,
    methodNotes: [
      'Initial generation was independent across providers.',
      'Reviews hid explicit author-provider labels; writing style was not normalized.',
      'Ranking is a deterministic prototype review aggregate, not a probability of truth.',
      'Novelty is relative to supplied context; no literature verification was performed.',
      'Context-based evidence quotes were checked mechanically against the shared packet; general-knowledge evidence is unverified literature memory.',
      'A hypothesis whose declared falsifier a reviewer graded untestable is ranked below every testable candidate.',
      'Cross-provider convergence is reported as consensus crowding, never as confirmation: models sharing training literature agreeing is recall, not replication.',
    ],
  };
}

export function renderMarkdownReport(session: ResearchSession): string {
  const lines = [
    '# Hypothesis Council Report',
    '',
    '## Research goal',
    '',
    session.goal,
    '',
    '## Executive summary',
    '',
    `${session.candidates.length} hypotheses were generated; ${rankedCandidates(session).length} remained after deterministic lexical deduplication. Explicit provider labels were hidden during review.`,
    '',
  ];

  const crowding = session.consensusCrowding;
  if (crowding && crowding.clusters.length > 0) {
    lines.push(
      `Consensus crowding: ${crowding.crowdedCandidateIds.length} of ${session.candidates.length} independently generated hypotheses converged across providers (similarity >= ${crowding.similarityThreshold}). Convergence between models trained on the same literature is consensus recall, not independent replication; it never raises a candidate's rank.`,
      ''
    );
  } else if (crowding) {
    lines.push(
      'Consensus crowding: none detected; no cross-provider convergence above the similarity threshold.',
      ''
    );
  }

  lines.push(
    '> Rankings summarize model review signals. They are not calibrated scientific probabilities.',
    '',
    '## Ranked hypotheses',
    ''
  );

  const crowded = new Set(crowding?.crowdedCandidateIds ?? []);

  for (const candidate of rankedCandidates(session)) {
    const review = session.reviews.find((item) => item.hypothesisId === candidate.id);
    const attack = session.falsifications.find((item) => item.hypothesisId === candidate.id);
    const evidenceLine = lacksVerifiedContextEvidence(candidate.evidence)
      ? `${describeEvidence(candidate.evidence)} — no verified context evidence; the claim rests on unverified memory or speculation`
      : describeEvidence(candidate.evidence);
    lines.push(
      `### ${candidate.rank || '—'}. ${candidate.id} — ${candidate.title}`,
      '',
      `**Claim:** ${candidate.claim}`,
      '',
      `**Mechanism:** ${candidate.mechanism}`,
      '',
      `**Predictions:** ${candidate.predictions.join('; ')}`,
      '',
      `**Differs from consensus:** ${candidate.differsFromConsensus || 'Not recorded (pre-upgrade session)'}`,
      '',
      `**Evidence basis:** ${evidenceLine}`,
      '',
      `**Minimal discriminating experiment:** ${candidate.minimalExperiment}`,
      '',
      `**Declared falsifier:** ${candidate.falsifier}${review?.killCriterion ? ` (graded ${review.killCriterion} by review)` : ''}`,
      '',
      `**Review signal:** ${candidate.score?.toFixed(2) || 'unavailable'} / 10 · novelty ${review ? `${review.novelty}/10` : 'unavailable'}${crowded.has(candidate.id) ? ' · consensus-crowded' : ''}`,
      '',
      `**Strongest objection:** ${review?.strongestObjection || 'Review unavailable'}`,
      '',
      `**Adversarial competing explanation:** ${attack?.competingExplanation || 'Not selected for finalist falsification'}`,
      '',
      `**Unresolved fatal flaw:** ${review?.fatalFlaw || 'None recorded'}`,
      '',
      '---',
      ''
    );
  }

  lines.push(
    '## Duplicates retained for audit',
    '',
    ...session.candidates
      .filter((candidate) => candidate.status === 'duplicate')
      .map((candidate) => `- ${candidate.id} (${candidate.title}) → ${candidate.duplicateOf}`),
    '',
    '## Council disagreements and limitations',
    '',
    ...session.warnings.map((warning) => `- ${warning}`),
    '- Authorship-label blinding does not remove provider-specific writing style.',
    '- Novelty was judged only against the supplied context.',
    '- Evidence verification checks quotes against the shared packet; it cannot validate general-knowledge claims, which remain unverified literature memory.',
    '- This first slice defers pairwise Elo, evolution, and literature verification.',
    '',
    '## Context and reproducibility',
    '',
    `- Session: ${session.id}`,
    `- Seed: ${session.config.seed}`,
    `- Providers: ${session.providers.join(', ')}`,
    `- Context packet SHA-256: ${session.contextManifest.packetSha256}`,
    `- Prompt versions and raw outputs: ${session.calls.length} recorded calls in the session directory`,
    ''
  );
  return lines.join('\n');
}
