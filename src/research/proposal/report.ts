import { rankedDrafts } from './interview.js';
import type {
  ExperimentStep,
  InterviewQuestion,
  MergedProposal,
  ProposalDraft,
  ProposalSession,
} from './types.js';

function list(items: string[] | undefined, empty = 'None recorded'): string[] {
  if (!items || items.length === 0) return [`- ${empty}`];
  return items.map((item) => `- ${item}`);
}

function stepLines(step: ExperimentStep): string[] {
  return [
    `### Step ${step.step}: ${step.title}`,
    '',
    `**Method:** ${step.method}`,
    '',
    `**Metrics:** ${step.metrics.join('; ') || 'none recorded'}`,
    '',
    `**Success criterion:** ${step.successCriteria}`,
    '',
    `**Kill criterion:** ${step.killCriteria}`,
    '',
    `**Resources:** ${step.resources.join('; ') || 'none recorded'} · **Effort:** ${step.estimatedEffort}${step.dependsOn?.length ? ` · **Depends on:** ${step.dependsOn.map((n) => `step ${n}`).join(', ')}` : ''}`,
    '',
  ];
}

/** The proposal body shared by the merged proposal, a single draft, and the executor prompt. */
export function proposalBodyLines(proposal: MergedProposal | ProposalDraft): string[] {
  const lines = ['## Background', '', proposal.background, '', '## Hypotheses', ''];
  proposal.hypotheses.forEach((hypothesis, index) => {
    lines.push(
      `${index + 1}. **${hypothesis.statement}**`,
      `   - Rationale: ${hypothesis.rationale}`,
      `   - Falsifier: ${hypothesis.falsifier}`
    );
  });
  lines.push('', '## Experiment plan', '');
  for (const step of [...proposal.experiments].sort((a, b) => a.step - b.step)) {
    lines.push(...stepLines(step));
  }
  lines.push(
    '## Risks',
    '',
    ...list(proposal.risks),
    '',
    '## Data needs',
    '',
    ...list(proposal.dataNeeds),
    '',
    '## Deliverables',
    '',
    ...list(proposal.deliverables),
    ''
  );
  if (proposal.openAssumptions && proposal.openAssumptions.length > 0) {
    lines.push('## Open assumptions', '', ...list(proposal.openAssumptions), '');
  }
  return lines;
}

function questionLines(question: InterviewQuestion): string[] {
  const answer =
    question.status === 'answered'
      ? (question.answer ?? '')
      : question.status === 'skipped'
        ? '_(skipped)_'
        : question.status === 'auto-resolved'
          ? `_(covered by ${question.resolvedBy ?? 'an earlier answer'})_`
          : '_(not answered)_';
  const asked = question.askedByCount > 1 ? ` · asked by ${question.askedByCount} members` : '';
  return [
    `**${question.id}** (${question.priority}${asked}): ${question.question}`,
    '',
    `> ${question.whyItMatters}`,
    '',
    `**A:** ${answer}`,
    '',
  ];
}

export function renderTranscriptMarkdown(session: ProposalSession): string {
  const lines = [
    `# Interview transcript: ${session.id}`,
    '',
    `Topic: ${session.topic}`,
    '',
    `Mode: ${session.config.interviewVisibility} · rounds: ${session.rounds.length} of ${session.config.maxRounds}`,
    '',
  ];
  if (session.questions.length === 0) {
    lines.push('No interview questions were asked.', '');
    return lines.join('\n');
  }
  for (const round of session.rounds) {
    lines.push(`## Round ${round.round}`, '');
    const questions = session.questions.filter((question) => question.round === round.round);
    if (questions.length === 0) lines.push('No new questions this round.', '');
    for (const question of questions) lines.push(...questionLines(question));
  }
  return lines.join('\n');
}

function draftSummaryLines(session: ProposalSession): string[] {
  const drafts = rankedDrafts(session);
  if (drafts.length === 0) return ['- No drafts were produced.'];
  return drafts.map((draft) => {
    const critiques = session.critiques.filter((critique) => critique.draftId === draft.id);
    const verdicts = critiques.map((critique) => critique.verdict).join(', ') || 'no critique';
    const objection = critiques[0]?.strongestObjection;
    const fatal = critiques.find((critique) => critique.fatalGap)?.fatalGap;
    return `- **${draft.rank ?? '-'}. ${draft.id}: ${draft.title}** · score ${draft.score?.toFixed(2) ?? 'n/a'} · ${verdicts}${fatal ? ` · fatal gap: ${fatal}` : ''}${objection ? `\n  - Strongest objection: ${objection}` : ''}`;
  });
}

export function renderProposalMarkdown(session: ProposalSession): string {
  const proposal = session.proposal;
  const lines = [
    `# Research proposal: ${proposal?.title ?? session.topic}`,
    '',
    `Session ${session.id} · status ${session.status} · ${session.config.providers.length} council members`,
    '',
    '## Topic',
    '',
    session.topic,
    '',
  ];
  if (session.config.fromSessionId) {
    lines.push(
      `Seeded from council session ${session.config.fromSessionId} (${session.priorFindings?.length ?? 0} ranked findings).`,
      ''
    );
  }
  if (!proposal) {
    lines.push('No proposal has been produced yet.', '');
  } else {
    lines.push(
      `Source: ${proposal.source === 'synthesized' ? 'synthesized from the council drafts' : `picked draft ${proposal.sourceDraftId ?? ''}`.trim()}`,
      '',
      ...proposalBodyLines(proposal)
    );
    if (proposal.rationale) lines.push('## Synthesis rationale', '', proposal.rationale, '');
    if (proposal.alternatives.length > 0) {
      lines.push('## Alternatives kept', '', ...list(proposal.alternatives), '');
    }
  }
  lines.push('## Council drafts (blind critique ranking)', '', ...draftSummaryLines(session), '');
  lines.push(
    '## Interview',
    '',
    `${session.questions.length} question${session.questions.length === 1 ? '' : 's'} over ${session.rounds.length} round${session.rounds.length === 1 ? '' : 's'}; full transcript in transcript.md.`,
    ''
  );
  if (session.warnings.length > 0) lines.push('## Warnings', '', ...list(session.warnings), '');
  lines.push(
    '## Method notes',
    '',
    '- Council members asked their interview questions independently; near-duplicate questions were merged.',
    '- Drafts were written independently from the same transcript and context; critiques hid author labels and never came from the author.',
    '- Rankings summarize model critiques. They are not calibrated estimates of scientific merit.',
    ''
  );
  return lines.join('\n');
}

export function renderDraftMarkdown(session: ProposalSession, draft: ProposalDraft): string {
  const critiques = session.critiques.filter((critique) => critique.draftId === draft.id);
  const lines = [
    `# Draft ${draft.id}: ${draft.title}`,
    '',
    `Session ${session.id} · rank ${draft.rank ?? '-'} · score ${draft.score?.toFixed(2) ?? 'n/a'}`,
    '',
    ...proposalBodyLines(draft),
  ];
  if (critiques.length > 0) {
    lines.push('## Blind critique', '');
    for (const critique of critiques) {
      lines.push(
        `- Verdict: ${critique.verdict} (confidence ${critique.confidence.toFixed(2)}) · feasibility ${critique.feasibility} · rigor ${critique.rigor} · clarity ${critique.clarity} · completeness ${critique.completeness} · kill criteria ${critique.killCriteriaQuality}`,
        `- Strongest objection: ${critique.strongestObjection}`,
        ...(critique.fatalGap ? [`- Fatal gap: ${critique.fatalGap}`] : []),
        ...(critique.missingSteps.length > 0
          ? [`- Missing steps: ${critique.missingSteps.join('; ')}`]
          : []),
        ...(critique.suggestedChanges.length > 0
          ? [`- Suggested changes: ${critique.suggestedChanges.join('; ')}`]
          : []),
        ''
      );
    }
  }
  return lines.join('\n');
}
