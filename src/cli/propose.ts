import { resolve } from 'path';
import {
  nextAction,
  openQuestions,
  questionOrder,
  rankedDrafts,
} from '../research/proposal/interview.js';
import type { ProposalPreview, ProposalSession, ProposeInput } from '../research/proposal/types.js';
import { describeDials, type DialConfig } from '../research/settings.js';
import type { SessionMeta } from '../research/types.js';
import { formatBytes } from './format.js';

export interface ProposeCliOptions {
  topicParts: string[];
  contextPaths: string[];
  repositoryPath?: string;
  providers?: string[];
  minProviders?: number;
  seed?: number;
  maxContextBytes?: number;
  markdownOnly?: boolean;
  rounds?: number;
  maxQuestions?: number;
  visible?: boolean;
  pick?: boolean;
  interview?: boolean;
  fromSessionId?: string;
  dials?: DialConfig;
  meta?: SessionMeta;
}

export function createProposeInput(options: ProposeCliOptions, cwd = process.cwd()): ProposeInput {
  const topic = options.topicParts.join(' ').trim();
  if (!topic)
    throw new Error('A proposal topic is required, for example: hc propose "Reduce p99 latency"');
  return {
    topic,
    contextPaths: options.contextPaths,
    contextRoot: resolve(cwd, options.repositoryPath || '.'),
    providers: options.providers,
    minProviders: options.minProviders,
    seed: options.seed,
    maxContextBytes: options.maxContextBytes,
    markdownOnly: options.markdownOnly,
    maxRounds: options.rounds,
    maxQuestionsPerProvider: options.maxQuestions,
    interviewVisibility: options.visible ? 'visible' : 'sealed',
    mergeStrategy: options.pick ? 'pick' : 'synthesize',
    interview: options.interview,
    fromSessionId: options.fromSessionId,
    dials: options.dials,
    meta: options.meta,
  };
}

export function proposalStageLabel(session: ProposalSession): string {
  if (session.status === 'failed') return 'NEEDS ATTENTION';
  if (session.status === 'interrupted') return 'INTERRUPTED';
  return session.stage.toUpperCase();
}

export function proposalsText(sessions: ProposalSession[]): string {
  return (
    sessions
      .map((session) => `${session.id}  ${proposalStageLabel(session)}  ${session.topic}`)
      .join('\n') || 'No proposals yet. Start one with /propose "<topic>".'
  );
}

export function proposalPreviewLines(preview: ProposalPreview): string[] {
  const calls = preview.plannedCalls;
  const lines = [
    `Topic: ${preview.topic}`,
    `Providers: ${preview.providers.join(', ')} (min ${preview.minProviders})`,
    `Interview: ${preview.interview ? `up to ${preview.maxRounds} round${preview.maxRounds === 1 ? '' : 's'}, ${preview.interviewVisibility}` : 'skipped'} · merge: ${preview.mergeStrategy}`,
    `Dials: ${describeDials(preview.dials)}`,
    `Planned calls: ${calls.total} (${calls.interview} interview, ${calls.drafts} drafts, ${calls.critiques} critiques, ${calls.synthesis} synthesis)`,
    `Context: ${preview.contextManifest.files.length} file${preview.contextManifest.files.length === 1 ? '' : 's'}, ${formatBytes(preview.contextManifest.packetBytes ?? preview.contextManifest.includedBytes)} of ${formatBytes(preview.contextBudget.maxBytes)}${preview.markdownOnly ? ' · Markdown only' : ''}`,
  ];
  if (preview.fromSessionId) {
    lines.push(`Seeded from ${preview.fromSessionId}: ${preview.priorFindings} ranked findings`);
  }
  return lines;
}

/** Open questions in priority order, numbered by id, for the person to answer. */
export function questionsText(session: ProposalSession, onlyOpen = true): string {
  const questions = questionOrder(onlyOpen ? openQuestions(session) : session.questions);
  if (questions.length === 0) {
    return onlyOpen ? 'No open questions.' : 'No interview questions yet.';
  }
  const lines: string[] = [];
  for (const question of questions) {
    const state = question.status === 'open' ? '' : ` (${question.status})`;
    lines.push(`${question.id} [${question.priority}]${state} ${question.question}`);
    lines.push(`    why: ${question.whyItMatters}`);
    if (question.status === 'answered') lines.push(`    answer: ${question.answer ?? ''}`);
  }
  return lines.join('\n');
}

export function draftsText(session: ProposalSession): string {
  const drafts = rankedDrafts(session);
  if (drafts.length === 0) return 'No drafts yet.';
  return drafts
    .map((draft) => {
      const critique = session.critiques.find((item) => item.draftId === draft.id);
      const verdict = critique
        ? `${critique.verdict}${critique.fatalGap ? ' · fatal gap' : ''}`
        : 'no critique';
      return `${draft.rank ?? '-'}. ${draft.id}  ${draft.title}  [score ${draft.score?.toFixed(2) ?? 'n/a'} · ${verdict} · ${draft.experiments.length} step${draft.experiments.length === 1 ? '' : 's'}]`;
    })
    .join('\n');
}

export function proposalStatusText(session: ProposalSession): string {
  const open = openQuestions(session).length;
  const answered = session.questions.filter((question) => question.status === 'answered').length;
  const lines = [
    `${session.id}  ${proposalStageLabel(session)}`,
    `Topic: ${session.topic}`,
    `Providers: ${session.providers.length}/${session.config.providers.length} ready`,
    `Interview: round ${session.rounds.length}/${session.config.maxRounds} · ${session.questions.length} questions (${open} open, ${answered} answered)${session.config.interview ? '' : ' · skipped'}`,
    `Drafts: ${session.drafts.length} · critiques: ${session.critiques.length}${session.proposal ? ` · proposal: ${session.proposal.title} (${session.proposal.source})` : ''}`,
  ];
  if (session.config.fromSessionId) lines.push(`Seeded from: ${session.config.fromSessionId}`);
  if (session.handoffs.length > 0) {
    const last = session.handoffs.at(-1)!;
    lines.push(`Handoff: ${last.id} -> ${last.executor.profile} (${last.status})`);
  }
  if (session.warnings.length > 0) {
    lines.push(`Warnings (${session.warnings.length}):`);
    for (const warning of session.warnings) lines.push(`  - ${warning}`);
  }
  if (session.proposalMarkdownPath) lines.push(`Proposal: ${session.proposalMarkdownPath}`);
  if (session.error) lines.push(`Error: ${session.error}`);
  lines.push(`Next: ${nextAction(session).message}`);
  return lines.join('\n');
}

export function proposalSummaryText(session: ProposalSession): string {
  const proposal = session.proposal;
  if (!proposal) return proposalStatusText(session);
  const lines = [
    `${session.id}  ${proposalStageLabel(session)}`,
    `Proposal: ${proposal.title} (${proposal.source === 'synthesized' ? 'synthesized from the drafts' : `picked ${proposal.sourceDraftId}`})`,
    `Hypotheses: ${proposal.hypotheses.length} · steps: ${proposal.experiments.length} · deliverables: ${proposal.deliverables.length}`,
  ];
  for (const step of [...proposal.experiments].sort((a, b) => a.step - b.step)) {
    lines.push(`  ${step.step}. ${step.title} (${step.estimatedEffort})`);
  }
  if (proposal.alternatives.length > 0)
    lines.push(`Alternatives kept: ${proposal.alternatives.length}`);
  lines.push(
    'Drafts:',
    ...draftsText(session)
      .split('\n')
      .map((line) => `  ${line}`)
  );
  if (session.warnings.length > 0) {
    lines.push(`Warnings (${session.warnings.length}):`);
    for (const warning of session.warnings) lines.push(`  - ${warning}`);
  }
  if (session.proposalMarkdownPath) lines.push(`Proposal file: ${session.proposalMarkdownPath}`);
  lines.push(`Next: ${nextAction(session).message}`);
  return lines.join('\n');
}
