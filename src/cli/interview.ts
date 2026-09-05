import {
  currentRound,
  interviewDone,
  openQuestions,
  questionOrder,
} from '../research/proposal/interview.js';
import type { ProposalAnswers, ResearchProposalService } from '../research/proposal/service.js';
import type { ProposalSession } from '../research/proposal/types.js';
import type { ResearchProgressHandler } from '../research/types.js';
import { questionsText } from './propose.js';
import type { ShellIO } from './shell/io.js';

export interface InterviewLoopOptions {
  /** Answers supplied up front (for example from `--answers FILE`); unknown ids are ignored. */
  answers?: ProposalAnswers;
  progress?: ResearchProgressHandler;
  signal?: AbortSignal;
}

export const INTERVIEW_HINT =
  'Type an answer, "skip", "/done" to finish the interview, or "/later" to pause.';

export const NON_INTERACTIVE_INTERVIEW_HINT =
  'Answer with `hc propose answer Q-001 "..."` (or --answers FILE), then `hc propose next` or `hc propose done`.';

function presetAnswers(
  session: ProposalSession,
  answers: ProposalAnswers | undefined
): ProposalAnswers {
  const result: ProposalAnswers = {};
  if (!answers) return result;
  for (const question of openQuestions(session)) {
    const key = Object.keys(answers).find((id) => id.trim().toUpperCase() === question.id);
    if (key !== undefined) result[question.id] = answers[key] ?? null;
  }
  return result;
}

/**
 * Drive the interview at the terminal: show each open question, record the answer, ask the
 * council for the next round while rounds remain, and stop when the interview is complete, the
 * person pauses, or nobody can answer. Returns the session in its persisted state.
 */
export async function runInterviewLoop(
  service: ResearchProposalService,
  sessionId: string,
  io: ShellIO,
  options: InterviewLoopOptions = {}
): Promise<ProposalSession> {
  let session = service.store.load(sessionId);
  let supplied = options.answers;
  while (session.stage === 'awaiting-answers') {
    const preset = presetAnswers(session, supplied);
    supplied = undefined;
    if (Object.keys(preset).length > 0) {
      session = service.answer(session.id, preset);
      continue;
    }
    const open = questionOrder(openQuestions(session));
    const round = currentRound(session);
    if (open.length === 0) {
      if (interviewDone(session)) {
        session = service.finishInterview(session.id);
        break;
      }
      if (!io.isInteractive) {
        session = service.finishInterview(session.id);
        break;
      }
      const more = await io.confirm(
        `Round ${round} answered. Ask the council for round ${round + 1} of ${session.config.maxRounds}?`
      );
      if (!more) {
        session = service.finishInterview(session.id);
        break;
      }
      session = await service.nextRound(session.id, options.progress, options.signal);
      continue;
    }
    if (!io.isInteractive) {
      io.out(`Round ${round}: ${open.length} open question${open.length === 1 ? '' : 's'}.`);
      io.out(questionsText(session));
      io.err(NON_INTERACTIVE_INTERVIEW_HINT);
      return session;
    }
    io.out(
      `Round ${round} of ${session.config.maxRounds}: ${open.length} question${open.length === 1 ? '' : 's'} from the council. ${INTERVIEW_HINT}`
    );
    const answers: ProposalAnswers = {};
    let paused = false;
    let finished = false;
    for (const question of open) {
      io.out(`${question.id} [${question.priority}] ${question.question}`);
      io.out(`    why: ${question.whyItMatters}`);
      const line = await io.readLine(`${question.id}> `);
      const text = line?.trim();
      if (text === undefined || text === '/later') {
        paused = true;
        break;
      }
      if (text === '/done') {
        finished = true;
        break;
      }
      answers[question.id] = text === '' || /^skip$/i.test(text) ? null : text;
    }
    if (Object.keys(answers).length > 0) session = service.answer(session.id, answers);
    if (paused) {
      io.err(
        `Paused with ${openQuestions(session).length} open question(s); /next continues the interview.`
      );
      return service.store.load(session.id);
    }
    if (finished) {
      session = service.finishInterview(session.id);
      break;
    }
  }
  return session;
}
