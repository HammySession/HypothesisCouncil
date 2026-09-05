import { openQuestions } from '../../../research/proposal/interview.js';
import { withCouncilRuntime } from '../../../runtime.js';
import { parseArguments } from '../../arguments.js';
import { executeHandoff } from '../../handoff-command.js';
import {
  continueProposal,
  normalizeDraftId,
  normalizeQuestionId,
  parseInlineAnswers,
} from '../../propose-command.js';
import {
  draftsText,
  proposalStatusText,
  proposalSummaryText,
  proposalsText,
  questionsText,
} from '../../propose.js';
import { renderDraftMarkdown, renderProposalMarkdown } from '../../../research/proposal/report.js';
import { createPublicProposalReport } from '../../../research/proposal/public.js';
import type { ShellCommand } from '../registry.js';
import { loadSelectedProposal, proposalStore, selectedProposalId } from '../proposal-scope.js';
import { splitShellArguments } from '../tokenize.js';

export const proposalsCommand: ShellCommand = {
  name: 'proposals',
  usage: '/proposals',
  summary: 'List research proposals',
  run: (ctx) => {
    ctx.io.out(proposalsText(proposalStore(ctx).list()));
    return Promise.resolve();
  },
};

export const questionsCommand: ShellCommand = {
  name: 'questions',
  usage: '/questions [all]',
  summary: 'Show the open interview questions of the selected proposal',
  run: (ctx, args) => {
    ctx.io.out(questionsText(loadSelectedProposal(ctx), args !== 'all'));
    return Promise.resolve();
  },
};

export const answerCommand: ShellCommand = {
  name: 'answer',
  usage: '/answer Q-001 <answer> | /answer Q-001 skip',
  summary: 'Answer (or skip) one interview question without re-entering the interview',
  run: async (ctx, args) => {
    const words = splitShellArguments(args);
    const id = words[0];
    if (!id) throw new Error('Usage: /answer Q-001 <answer>');
    const text = words.slice(1).join(' ');
    const answers = parseInlineAnswers([id, text || 'skip'], parseArguments([]));
    const sessionId = selectedProposalId(ctx);
    const session = await withCouncilRuntime(ctx.runtimeFactory(ctx.store), (runtime) =>
      Promise.resolve(runtime.proposals.answer(sessionId, answers))
    );
    const open = openQuestions(session).length;
    ctx.io.out(
      `${normalizeQuestionId(id)} recorded; ${open} open question${open === 1 ? '' : 's'} left.${open === 0 ? ' /next asks for another round, /done drafts.' : ''}`
    );
  },
};

export const nextCommand: ShellCommand = {
  name: 'next',
  usage: '/next',
  summary: 'Continue the interview: answer open questions, or ask the council for the next round',
  run: async (ctx) => {
    const sessionId = selectedProposalId(ctx);
    const before = proposalStore(ctx).load(sessionId);
    const session = await continueProposal(sessionId, ctx.store, ctx, {
      signal: ctx.signal,
      nextRound: before.stage === 'awaiting-answers' && openQuestions(before).length === 0,
      draft: false,
    });
    ctx.io.out(proposalStatusText(session));
  },
};

export const doneCommand: ShellCommand = {
  name: 'done',
  usage: '/done',
  summary: 'Finish the interview (open questions are skipped), then draft, critique, and merge',
  run: async (ctx) => {
    const session = await continueProposal(selectedProposalId(ctx), ctx.store, ctx, {
      signal: ctx.signal,
      finish: true,
    });
    ctx.io.out(session.proposal ? proposalSummaryText(session) : proposalStatusText(session));
  },
};

export const draftCommand: ShellCommand = {
  name: 'draft',
  usage: '/draft',
  summary: 'Draft, critique, and merge once the interview is complete',
  run: async (ctx) => {
    const session = await continueProposal(selectedProposalId(ctx), ctx.store, ctx, {
      signal: ctx.signal,
    });
    ctx.io.out(session.proposal ? proposalSummaryText(session) : proposalStatusText(session));
  },
};

export const pickCommand: ShellCommand = {
  name: 'pick',
  usage: '/pick D-002',
  summary: 'Make one draft the proposal instead of the synthesis',
  run: async (ctx, args) => {
    if (!args) throw new Error('Usage: /pick D-002 (run /proposal drafts to list them)');
    const sessionId = selectedProposalId(ctx);
    const session = await withCouncilRuntime(ctx.runtimeFactory(ctx.store), (runtime) =>
      Promise.resolve(runtime.proposals.pick(sessionId, normalizeDraftId(args)))
    );
    ctx.io.out(proposalSummaryText(session));
  },
};

export const proposalCommand: ShellCommand = {
  name: 'proposal',
  usage: '/proposal [drafts | D-001 | json]',
  summary: 'Show the merged proposal, the ranked drafts, one draft, or the public JSON',
  run: (ctx, args) => {
    const session = loadSelectedProposal(ctx);
    if (args === 'drafts') {
      ctx.io.out(draftsText(session));
    } else if (args === 'json') {
      ctx.io.out(JSON.stringify(createPublicProposalReport(session), null, 2));
    } else if (args) {
      const draft = session.drafts.find((item) => item.id === normalizeDraftId(args));
      if (!draft)
        throw new Error(
          `Draft not found: ${args} (available: ${session.drafts.map((item) => item.id).join(', ') || 'none'})`
        );
      ctx.io.out(renderDraftMarkdown(session, draft));
    } else {
      ctx.io.out(renderProposalMarkdown(session));
    }
    return Promise.resolve();
  },
};

export const handoffCommand: ShellCommand = {
  name: 'handoff',
  usage:
    '/handoff claude|codex|agy|grok|NAME [--repo PATH] [--model ID] [--print] [--run [--allow-dirty]]',
  summary: 'Write the executor bundle for the proposal and optionally run the executor',
  run: async (ctx, args) => {
    const words = splitShellArguments(args);
    const target = words[0];
    if (!target || target.startsWith('--')) {
      throw new Error('Usage: /handoff NAME [--repo PATH] [--model ID] [--print] [--run]');
    }
    const parsed = parseArguments(['--to', target, ...words.slice(1)]);
    if (!parsed.flags.has('--repo')) parsed.flags.set('--repo', [ctx.state.repoRoot]);
    const outcome = await executeHandoff(parsed, selectedProposalId(ctx), ctx.store, ctx, {
      signal: ctx.signal,
      interactive: true,
      preset: ctx.state.preset,
    });
    ctx.io.out(proposalStatusText(outcome.session));
  },
};
