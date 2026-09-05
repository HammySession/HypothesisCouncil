import { textSimilarity } from '../dedup.js';
import type { InterviewOutput } from './schemas.js';
import type {
  InterviewQuestion,
  InterviewVisibility,
  ProposalCritique,
  ProposalDraft,
  ProposalNextAction,
  ProposalSession,
} from './types.js';

/** Similarity above which two questions count as the same question. */
export const QUESTION_MERGE_THRESHOLD = 0.5;

export interface IncomingQuestions {
  provider: string;
  output: InterviewOutput;
}

function nextQuestionId(session: ProposalSession): string {
  return `Q-${String(session.questions.length + 1).padStart(3, '0')}`;
}

function similar(left: InterviewQuestion, question: string, threshold: number): boolean {
  return textSimilarity(left.question, question) >= threshold;
}

/**
 * Merge one round of provider questions into the session. Questions are taken provider by
 * provider in sorted order so ids are deterministic. A near-duplicate of an open question joins
 * it (the count and private sources grow); a near-duplicate of an answered or skipped question
 * is recorded as `auto-resolved` by that earlier answer. Returns the ids added or merged this
 * round in order.
 */
export function mergeQuestions(
  session: ProposalSession,
  incoming: IncomingQuestions[],
  round: number,
  threshold = QUESTION_MERGE_THRESHOLD
): string[] {
  const touched: string[] = [];
  const perProvider = session.config.maxQuestionsPerProvider;
  const perRound = session.config.maxQuestionsPerRound;
  let added = 0;
  for (const batch of [...incoming].sort((a, b) => a.provider.localeCompare(b.provider))) {
    for (const question of batch.output.questions.slice(0, perProvider)) {
      const text = question.question.trim();
      if (!text) continue;
      const existing = session.questions.find((item) => similar(item, text, threshold));
      if (existing) {
        if (!existing.sources.includes(batch.provider)) {
          existing.sources.push(batch.provider);
          existing.askedByCount = existing.sources.length;
        }
        if (!touched.includes(existing.id)) touched.push(existing.id);
        continue;
      }
      if (added >= perRound) break;
      const resolvedBy = session.questions.find(
        (item) =>
          (item.status === 'answered' || item.status === 'skipped') &&
          similar(item, text, threshold * 0.8)
      );
      const record: InterviewQuestion = {
        ...question,
        question: text,
        id: nextQuestionId(session),
        round,
        sources: [batch.provider],
        askedByCount: 1,
        status: resolvedBy ? 'auto-resolved' : 'open',
        resolvedBy: resolvedBy?.id,
      };
      session.questions.push(record);
      touched.push(record.id);
      added++;
    }
  }
  return touched;
}

/** Sealed mode shows a provider only the questions it asked itself; visible mode shows all. */
export function visibleQuestions(
  session: ProposalSession,
  provider: string,
  visibility: InterviewVisibility = session.config.interviewVisibility
): InterviewQuestion[] {
  if (visibility === 'visible') return session.questions;
  return session.questions.filter((question) => question.sources.includes(provider));
}

export function openQuestions(session: ProposalSession): InterviewQuestion[] {
  return session.questions.filter((question) => question.status === 'open');
}

/** Priority order for showing questions to the person. */
export function questionOrder(questions: InterviewQuestion[]): InterviewQuestion[] {
  const weight = { high: 0, medium: 1, low: 2 };
  return [...questions].sort(
    (left, right) =>
      weight[left.priority] - weight[right.priority] ||
      right.askedByCount - left.askedByCount ||
      left.id.localeCompare(right.id)
  );
}

function answerLine(question: InterviewQuestion, session: ProposalSession): string {
  switch (question.status) {
    case 'answered':
      return `A: ${question.answer ?? ''}`;
    case 'skipped':
      return 'A: (the person skipped this question)';
    case 'auto-resolved': {
      const earlier = session.questions.find((item) => item.id === question.resolvedBy);
      return `A: (covered by ${question.resolvedBy}: ${earlier?.answer ?? 'skipped'})`;
    }
    default:
      return 'A: (not answered yet)';
  }
}

/** The transcript as prompts and reports see it: questions and answers, never who asked. */
export function transcript(
  session: ProposalSession,
  questions: InterviewQuestion[] = session.questions
): string {
  if (questions.length === 0) return '(no interview questions)';
  return questions
    .map(
      (question) =>
        `${question.id} (round ${question.round}, ${question.priority}): ${question.question}\n${answerLine(question, session)}`
    )
    .join('\n\n');
}

export function currentRound(session: ProposalSession): number {
  return session.rounds.length;
}

/** Providers that still have questions to ask in a later round. */
export function activeInterviewers(session: ProposalSession): string[] {
  const done = new Set(session.rounds.flatMap((round) => round.doneProviders));
  return session.providers.filter((provider) => !done.has(provider));
}

export function interviewDone(session: ProposalSession): boolean {
  if (!session.config.interview) return true;
  if (openQuestions(session).length > 0) return false;
  return (
    currentRound(session) >= session.config.maxRounds || activeInterviewers(session).length === 0
  );
}

export function nextAction(session: ProposalSession): ProposalNextAction {
  const open = openQuestions(session).length;
  const round = currentRound(session);
  const base = { openQuestions: open, round };
  if (session.status === 'failed' || session.status === 'interrupted') {
    return { ...base, kind: 'resume', message: `Session ${session.status}; resume to continue.` };
  }
  if (session.stage === 'awaiting-answers') {
    if (open > 0) {
      return {
        ...base,
        kind: 'answer',
        message: `${open} open question${open === 1 ? '' : 's'} in round ${round}.`,
      };
    }
    if (interviewDone(session)) {
      return { ...base, kind: 'draft', message: 'Interview complete; draft the proposal.' };
    }
    return {
      ...base,
      kind: 'next-round',
      message: `Round ${round} answered; ask for round ${round + 1} or finish the interview.`,
    };
  }
  if (session.stage === 'interview-complete') {
    return { ...base, kind: 'draft', message: 'Interview complete; draft the proposal.' };
  }
  if (session.stage === 'proposed' && session.proposal) {
    return { ...base, kind: 'handoff', message: 'Proposal ready; hand it to an executor.' };
  }
  if (session.stage === 'proposed') {
    return { ...base, kind: 'pick', message: 'Drafts ready; pick one.' };
  }
  if (session.status === 'running') {
    return { ...base, kind: 'resume', message: `Stage ${session.stage} in progress.` };
  }
  return { ...base, kind: 'done', message: `Session ${session.status}.` };
}

function critiqueScore(critique: ProposalCritique): number {
  return (critique.feasibility + critique.rigor + critique.clarity + critique.completeness) / 4;
}

/**
 * Rank drafts by their critiques: a fatal gap or fatal verdict sinks a draft below every other,
 * an untestable kill criterion sinks it below every testable one, then the mean of the four
 * critique scores decides, then the draft id.
 */
export function rankDrafts(
  drafts: ProposalDraft[],
  critiques: ProposalCritique[]
): ProposalDraft[] {
  const scored = drafts.map((draft) => {
    const own = critiques.filter((critique) => critique.draftId === draft.id);
    const fatal = own.some((critique) => critique.verdict === 'fatal' || !!critique.fatalGap);
    const untestable = own.some((critique) => critique.killCriteriaQuality === 'untestable');
    const score =
      own.length === 0
        ? 0
        : own.reduce((sum, critique) => sum + critiqueScore(critique), 0) / own.length;
    return { draft, fatal, untestable, score: Math.round(score * 100) / 100 };
  });
  scored.sort(
    (left, right) =>
      Number(left.fatal) - Number(right.fatal) ||
      Number(left.untestable) - Number(right.untestable) ||
      right.score - left.score ||
      left.draft.id.localeCompare(right.draft.id)
  );
  return scored.map((entry, index) => ({ ...entry.draft, rank: index + 1, score: entry.score }));
}

export function rankedDrafts(session: ProposalSession): ProposalDraft[] {
  return [...session.drafts].sort((left, right) => (left.rank || 999) - (right.rank || 999));
}
