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
    methodNotes: [
      'Initial generation was independent across providers.',
      'Reviews hid explicit author-provider labels; writing style was not normalized.',
      'Ranking is a deterministic prototype review aggregate, not a probability of truth.',
      'Novelty is relative to supplied context; no literature verification was performed.',
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
    '> Rankings summarize model review signals. They are not calibrated scientific probabilities.',
    '',
    '## Ranked hypotheses',
    '',
  ];

  for (const candidate of rankedCandidates(session)) {
    const review = session.reviews.find((item) => item.hypothesisId === candidate.id);
    const attack = session.falsifications.find((item) => item.hypothesisId === candidate.id);
    lines.push(
      `### ${candidate.rank || '—'}. ${candidate.id} — ${candidate.title}`,
      '',
      `**Claim:** ${candidate.claim}`,
      '',
      `**Mechanism:** ${candidate.mechanism}`,
      '',
      `**Predictions:** ${candidate.predictions.join('; ')}`,
      '',
      `**Minimal discriminating experiment:** ${candidate.minimalExperiment}`,
      '',
      `**Declared falsifier:** ${candidate.falsifier}`,
      '',
      `**Review signal:** ${candidate.score?.toFixed(2) || 'unavailable'} / 10`,
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
