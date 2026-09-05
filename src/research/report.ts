import { describeEvidence, lacksVerifiedContextEvidence } from './evidence.js';
import { DEFAULT_DIAL_POLICY } from './dials.js';
import { explainRanking } from './ranking.js';
import { publicSource, type SourceRecord } from './sources.js';
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
    meta: session.meta,
    status: session.status,
    stage: session.stage,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    config: session.config,
    providers: session.providers,
    unavailableProviders: session.unavailableProviders,
    contextManifest: session.contextManifest,
    sources: session.sources?.map(publicSource),
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
    sources: session.sources?.map(publicSource),
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
    weaklySupportedCandidateIds: weaklySupported(session).map((candidate) => candidate.id),
    methodNotes: [
      'Initial generation was independent across providers.',
      'Reviews hid explicit author-provider labels; writing style was not normalized.',
      'Ranking is a deterministic prototype review aggregate, not a probability of truth.',
      'Ranking weights, penalties, and gates follow the novelty and skepticism dials recorded under the session configuration.',
      'Novelty is relative to supplied context; no literature verification was performed.',
      'Context-based evidence quotes were checked mechanically against the shared packet; general-knowledge evidence is unverified literature memory.',
      'A hypothesis whose declared falsifier a reviewer graded untestable is ranked below every testable candidate.',
      'Cross-provider convergence is reported as consensus crowding, never as confirmation: models sharing training literature agreeing is recall, not replication. Above the default novelty level crowding lowers a candidate score; it never raises one.',
      ...(session.sources?.length
        ? [
            'Cited sources were fetched mechanically to confirm they exist; reachability is not correctness. Scout summaries and reliability grades are model-written and unverified.',
          ]
        : []),
    ],
  };
}

function weaklySupported(session: ResearchSession): HypothesisCandidate[] {
  const policy = session.config.policy ?? DEFAULT_DIAL_POLICY;
  return rankedCandidates(session).filter((candidate) =>
    lacksVerifiedContextEvidence(candidate.evidence, policy)
  );
}

function sourceStatus(source: SourceRecord): string {
  const verification = source.verification;
  if (!verification) return 'unchecked';
  if (verification.status === 'reachable') {
    return verification.titleFound === false ? 'reachable, title not found' : 'reachable';
  }
  if (verification.status === 'skipped') return source.url || source.doi ? 'not fetched' : 'no URL';
  return verification.status;
}

function sourceLines(session: ResearchSession): string[] {
  const sources = session.sources ?? [];
  const config = session.config.sources;
  if (sources.length === 0 && !config) return [];
  const userCount = sources.filter((source) => source.origin === 'user').length;
  const lines = [
    '## Sources',
    '',
    `${sources.length} source record${sources.length === 1 ? '' : 's'} were available to the council (${userCount} supplied with the run, ${sources.length - userCount} proposed by ${config?.scouts.length ?? 0} web scout${config?.scouts.length === 1 ? '' : 's'}${config ? ` over ${config.rounds} round${config.rounds === 1 ? '' : 's'}` : ''}). Verification mode: ${config?.verification ?? 'none'}${config?.critique ? '; every record was graded blind by a council provider' : ''}. Reachable means the URL resolved, not that the work is correct; summaries and grades are model-written.`,
    '',
  ];
  if (sources.length > 0) {
    lines.push(
      '| Id | Kind | Title | Year | Verification | Reliability | Replication |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...sources.map((source) => {
        const link = source.url ? `[${source.title}](${source.url})` : source.title;
        const doi = source.doi ? ` (doi:${source.doi})` : '';
        return `| ${source.id} | ${source.kind} | ${link.replace(/\|/g, '\\|')}${doi} | ${source.year ?? '—'} | ${sourceStatus(source)} | ${source.critique ? `${source.critique.reliability}/10` : '—'} | ${source.critique?.replication ?? '—'} |`;
      }),
      ''
    );
    const concerns = sources.filter((source) => source.critique?.concerns.length);
    if (concerns.length > 0) {
      lines.push(
        'Concerns raised by the critique:',
        '',
        ...concerns.map(
          (source) => `- ${source.id}: ${source.critique?.concerns.join('; ') ?? ''}`
        ),
        ''
      );
    }
  }
  return lines;
}

function unverifiedCitations(candidate: HypothesisCandidate): string[] {
  return (candidate.evidence ?? [])
    .filter((entry) => entry.basis === 'source' && entry.verification !== 'verified')
    .map((entry) => entry.sourceId ?? 'unknown source');
}

function penaltyNote(candidate: HypothesisCandidate): string {
  const penalties = candidate.scorePenalties;
  if (!penalties) return '';
  const parts: string[] = [];
  if (penalties.crowding) parts.push(`crowding −${penalties.crowding.toFixed(2)}`);
  if (penalties.unsupportedEvidence) {
    parts.push(`unsupported evidence −${penalties.unsupportedEvidence.toFixed(2)}`);
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

function configurationLines(session: ResearchSession): string[] {
  const { dials, policy } = session.config;
  const lines = ['## Session configuration', ''];
  if (!dials || !policy) {
    lines.push(
      '- Dials: not recorded (the session predates the novelty and skepticism dials); ranking used the default policy.',
      ...explainRanking(DEFAULT_DIAL_POLICY).map((line) => `- ${line}`)
    );
  } else {
    lines.push(
      `- Novelty: ${dials.novelty}/10 (${dials.origins.novelty}) · Skepticism: ${dials.skepticism}/10 (${dials.origins.skepticism})`,
      ...explainRanking(policy).map((line) => `- ${line}`),
      `- Generation: ${session.config.hypothesesPerProvider} hypotheses per provider${policy.outOfBoxCalls > 0 ? ` plus ${policy.outOfBoxCalls} out-of-the-box call per provider requesting ${policy.outOfBoxHypotheses}` : ''}`,
      `- Falsification rounds per finalist: ${policy.falsificationRounds}`
    );
  }
  const versions = [...new Set(session.calls.map((call) => call.promptVersion))].sort();
  lines.push(`- Prompt versions: ${versions.join(', ') || 'none recorded'}`, '');
  return lines;
}

export function renderMarkdownReport(session: ResearchSession): string {
  const policy = session.config.policy ?? DEFAULT_DIAL_POLICY;
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
      `Consensus crowding: ${crowding.crowdedCandidateIds.length} of ${session.candidates.length} independently generated hypotheses converged across providers (similarity >= ${crowding.similarityThreshold}). Convergence between models trained on the same literature is consensus recall, not independent replication; it never raises a candidate's rank${policy.crowdingPenalty > 0 ? `, and at novelty ${policy.novelty}/10 each crowded candidate loses ${policy.crowdingPenalty.toFixed(2)} points` : ''}.`,
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
    const attacks = session.falsifications.filter((item) => item.hypothesisId === candidate.id);
    const attack = attacks.find((item) => (item.round ?? 1) === 1) ?? attacks[0];
    const laterAttacks = attacks.filter((item) => item !== attack);
    const evidenceLine = lacksVerifiedContextEvidence(candidate.evidence)
      ? `${describeEvidence(candidate.evidence)} — no verified context evidence; the claim rests on unverified memory or speculation`
      : describeEvidence(candidate.evidence);
    lines.push(
      `### ${candidate.rank || '—'}. ${candidate.id} — ${candidate.title}${candidate.variant === 'out-of-box' ? ' (out-of-the-box batch)' : ''}`,
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
      `**Review signal:** ${candidate.score?.toFixed(2) || 'unavailable'} / 10${penaltyNote(candidate)} · novelty ${review ? `${review.novelty}/10` : 'unavailable'}${crowded.has(candidate.id) ? ' · consensus-crowded' : ''}`,
      '',
      `**Strongest objection:** ${review?.strongestObjection || 'Review unavailable'}`,
      '',
      `**Adversarial competing explanation:** ${attack?.competingExplanation || 'Not selected for finalist falsification'}`,
      ''
    );
    for (const later of laterAttacks) {
      lines.push(
        `**Adversarial round ${later.round ?? 2} competing explanation:** ${later.competingExplanation}`,
        ''
      );
    }
    lines.push(`**Unresolved fatal flaw:** ${review?.fatalFlaw || 'None recorded'}`, '', '---', '');
  }

  lines.push(
    '## Duplicates retained for audit',
    '',
    ...session.candidates
      .filter((candidate) => candidate.status === 'duplicate')
      .map((candidate) => `- ${candidate.id} (${candidate.title}) → ${candidate.duplicateOf}`),
    ''
  );

  lines.push(...sourceLines(session));

  const weak = weaklySupported(session);
  if (policy.weakClaimsSection && weak.length > 0) {
    lines.push(
      '## Weakly supported claims',
      '',
      `Skepticism ${policy.skepticism}/10 flags every ranked hypothesis whose claim rests on no verified context evidence${policy.discountWeakSources ? ' (a source graded below 4 for reliability or contested does not count)' : ''}.`,
      '',
      ...weak.map((candidate) => {
        const citations = unverifiedCitations(candidate);
        return `- ${candidate.id} (${candidate.title}): ${describeEvidence(candidate.evidence)}${citations.length > 0 ? `; unverified citations: ${citations.join(', ')}` : ''}`;
      }),
      ''
    );
  }

  lines.push(
    '## Council disagreements and limitations',
    '',
    ...session.warnings.map((warning) => `- ${warning}`),
    '- Authorship-label blinding does not remove provider-specific writing style.',
    '- Novelty was judged only against the supplied context.',
    '- Evidence verification checks quotes against the shared packet; it cannot validate general-knowledge claims, which remain unverified literature memory.',
    '- This first slice defers pairwise Elo, evolution, and literature verification.',
    '',
    ...configurationLines(session),
    '## Context and reproducibility',
    '',
    `- Session: ${session.id}`,
    `- Seed: ${session.config.seed}`,
    `- Providers: ${session.providers.join(', ')}`,
    `- Context packet SHA-256: ${session.contextManifest.packetSha256}`,
    ...(session.sources?.length
      ? [
          `- Sources: ${session.sources.length} records (${session.sources.filter((source) => source.verification?.status === 'reachable').length} reachable); verification ${session.config.sources?.verification ?? 'none'}`,
        ]
      : []),
    `- Prompt versions and raw outputs: ${session.calls.length} recorded calls in the session directory`,
    ''
  );
  return lines.join('\n');
}
