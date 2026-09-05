import { existsSync, lstatSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { openQuestions } from '../research/proposal/interview.js';
import { createPublicProposalReport, publicProposalSnapshot } from '../research/proposal/public.js';
import { renderDraftMarkdown, renderProposalMarkdown } from '../research/proposal/report.js';
import type { ProposalAnswers } from '../research/proposal/service.js';
import {
  isProposalId,
  proposalStoreFor,
  type ProposalSessionStore,
} from '../research/proposal/store.js';
import type { ProposalPreview, ProposalSession } from '../research/proposal/types.js';
import { dialsFromSettings } from '../research/settings.js';
import type { ResearchSessionStore } from '../research/store.js';
import { withCouncilRuntime } from '../runtime.js';
import {
  flag,
  flagValues,
  hasFlag,
  listFlag,
  numberFlag,
  pathFlag,
  valueFlag,
  type ParsedArguments,
} from './arguments.js';
import type { CliDependencies } from './dependencies.js';
import { executeHandoff } from './handoff-command.js';
import { runInterviewLoop } from './interview.js';
import { describeModels, type CouncilPreset } from './presets.js';
import { selectPreset } from './preset-selection.js';
import {
  createProposeInput,
  draftsText,
  proposalPreviewLines,
  proposalStatusText,
  proposalSummaryText,
  proposalsText,
  questionsText,
} from './propose.js';
import { resolveStoreSettings, settingsFlags } from './settings-command.js';
import type { ShellIO } from './shell/io.js';

export const PROPOSE_USAGE = `Usage:
  hc propose "<topic>" [--repo PATH] [--context PATH|GLOB]... [--from RC-SESSION] [--rounds N]
             [--max-questions N] [--visible] [--pick] [--no-interview] [--no-draft]
             [--answers FILE] [--preset NAME] [--providers a,b] [--yes] [--dry-run] [--json]
  hc propose list [--json]
  hc propose status [RP-SESSION] [--json]
  hc propose questions [RP-SESSION] [--all]
  hc propose answer [RP-SESSION] Q-001 "answer" [Q-002 "answer"]... [--skip Q-003] [--answers FILE]
  hc propose next [RP-SESSION]         Ask the council for the next interview round
  hc propose done [RP-SESSION]         Finish the interview (open questions are skipped) and draft
  hc propose draft [RP-SESSION]        Draft, critique, and merge (interview must be complete)
  hc propose pick [RP-SESSION] D-002   Make one draft the proposal
  hc propose show [RP-SESSION] D-001   Show one draft with its blind critique
  hc propose report [RP-SESSION] [--json]
  hc propose ask [RP-SESSION] "<question>" [--provider NAME]
  hc propose resume [RP-SESSION]
  hc propose handoff [RP-SESSION] --to claude|codex|agy|grok|NAME [--repo PATH] [--model ID]
             [--print] [--run [--yes] [--timeout-ms N] [--allow-dirty]]`;

export const PROPOSAL_CONTEXT_CONFIRMATION_REQUIRED =
  'Repository context is sent to external providers. Re-run with --yes after reviewing the preview, or use --dry-run to inspect it.';

const SUBCOMMANDS = new Set([
  'list',
  'status',
  'questions',
  'answer',
  'next',
  'done',
  'draft',
  'pick',
  'show',
  'report',
  'ask',
  'resume',
  'handoff',
]);

export interface ProposeRunOptions {
  /** The interactive shell already showed the preview; skip the confirmation prompt. */
  interactive?: boolean;
  signal?: AbortSignal;
  preset?: CouncilPreset;
}

export function printProposalPreview(io: ShellIO, preview: ProposalPreview): void {
  for (const line of proposalPreviewLines(preview)) io.err(line);
}

export async function confirmProposal(io: ShellIO, preview: ProposalPreview): Promise<void> {
  printProposalPreview(io, preview);
  if (!io.isInteractive) throw new Error(PROPOSAL_CONTEXT_CONFIRMATION_REQUIRED);
  const approved = await io.confirm('Send this context to the selected providers?');
  if (!approved) throw new Error('Proposal cancelled');
}

/** `--answers FILE` (a JSON object of question id to answer or null). */
export function parseAnswersFile(
  parsed: ParsedArguments,
  cwd: string
): ProposalAnswers | undefined {
  const path = pathFlag(parsed, '--answers');
  if (!path) return undefined;
  const absolute = resolve(cwd, path);
  if (!existsSync(absolute)) throw new Error(`Answers file not found: ${absolute}`);
  const parsedFile: unknown = JSON.parse(readFileSync(absolute, 'utf8'));
  if (!parsedFile || typeof parsedFile !== 'object' || Array.isArray(parsedFile)) {
    throw new Error('The answers file must be a JSON object of question id to answer (null skips)');
  }
  const answers: ProposalAnswers = {};
  for (const [id, value] of Object.entries(parsedFile as Record<string, unknown>)) {
    if (value !== null && typeof value !== 'string') {
      throw new Error(`Answer for ${id} must be a string or null`);
    }
    answers[id] = value;
  }
  return answers;
}

/** Positional `Q-001 "answer"` pairs plus `--skip` ids. */
export function parseInlineAnswers(words: string[], parsed: ParsedArguments): ProposalAnswers {
  const answers: ProposalAnswers = {};
  for (let index = 0; index < words.length; index += 2) {
    const id = words[index];
    if (!/^q-?\d+$/i.test(id)) throw new Error(`Expected a question id such as Q-001, got "${id}"`);
    const text = words[index + 1];
    if (text === undefined)
      throw new Error(`Missing answer for ${id} (use --skip ${id} to skip it)`);
    answers[normalizeQuestionId(id)] = /^skip$/i.test(text) ? null : text;
  }
  for (const id of listFlag(parsed, '--skip') ?? []) answers[normalizeQuestionId(id)] = null;
  return answers;
}

export function normalizeQuestionId(value: string): string {
  const match = value.trim().match(/^(?:q-?)?0*(\d+)$/i);
  return match ? `Q-${match[1].padStart(3, '0')}` : value.trim().toUpperCase();
}

export function normalizeDraftId(value: string): string {
  const match = value.trim().match(/^(?:d-?)?0*(\d+)$/i);
  return match ? `D-${match[1].padStart(3, '0')}` : value.trim().toUpperCase();
}

/** Start a proposal session: resolve the preset, build the input, preview, and run round one. */
export async function startProposal(
  parsed: ParsedArguments,
  store: ResearchSessionStore,
  deps: CliDependencies,
  options: ProposeRunOptions = {}
): Promise<ProposalSession | undefined> {
  const settings = resolveStoreSettings(store, deps.env, settingsFlags(parsed));
  const defaultName = options.preset ? undefined : settings.values.defaultPreset;
  const selected = await selectPreset(parsed, true, deps, { store, settings, defaultName });
  const preset = selected?.preset ?? options.preset;
  const repositoryPath = pathFlag(parsed, '--repo');
  const explicitContext = flagValues(parsed, '--context');
  const from = valueFlag(parsed, '--from', 'a council session id');
  const input = createProposeInput(
    {
      topicParts: parsed.positionals,
      contextPaths:
        explicitContext.length > 0 ? explicitContext : (settings.values.defaultContext ?? []),
      repositoryPath,
      providers: listFlag(parsed, '--providers') ?? preset?.providers,
      minProviders:
        numberFlag(parsed, '--min-providers') ??
        (hasFlag(parsed, '--allow-single') ? 1 : preset?.minProviders),
      seed: numberFlag(parsed, '--seed'),
      maxContextBytes: numberFlag(parsed, '--max-context-bytes'),
      markdownOnly: settings.values.markdownOnly,
      rounds: numberFlag(parsed, '--rounds'),
      maxQuestions: numberFlag(parsed, '--max-questions'),
      visible: hasFlag(parsed, '--visible'),
      pick: hasFlag(parsed, '--pick'),
      interview: hasFlag(parsed, '--no-interview') ? false : undefined,
      fromSessionId: from,
      dials: dialsFromSettings(settings),
      meta: preset ? { preset: preset.name } : undefined,
    },
    deps.cwd
  );
  if (!from && (input.contextPaths?.length ?? 0) === 0 && !repositoryPath) {
    // A proposal without context is legitimate (a question about the world), so unlike `run`
    // nothing defaults to the whole repository.
    input.contextPaths = [];
  }
  try {
    if (!input.contextRoot || !lstatSync(input.contextRoot).isDirectory()) throw new Error();
  } catch {
    throw new Error(`Repository directory not found: ${input.contextRoot || repositoryPath}`);
  }
  if (preset) deps.io.err(`Preset: ${preset.name}`);
  if (selected && preset?.modelSlots?.length) {
    deps.io.err(`Models: ${describeModels(preset, selected.models)}`);
  }
  if (hasFlag(parsed, '--dry-run')) {
    const preview = await withCouncilRuntime(deps.runtimeFactory(store), ({ proposals }) =>
      proposals.preview(input, options.signal)
    );
    printProposalPreview(deps.io, preview);
    deps.io.err('Dry run: no proposal was created and nothing was sent to a provider.');
    return undefined;
  }
  const automaticallyApproved = options.interactive || hasFlag(parsed, '--yes');
  const renderer = deps.createProgressRenderer();
  try {
    return await withCouncilRuntime(deps.runtimeFactory(store), ({ proposals }) =>
      proposals.start(input, renderer.handle, options.signal, async (preview) => {
        if (automaticallyApproved) printProposalPreview(deps.io, preview);
        else await confirmProposal(deps.io, preview);
      })
    );
  } finally {
    renderer.finish();
  }
}

export interface ContinueOptions {
  signal?: AbortSignal;
  answers?: ProposalAnswers;
  /** Draft once the interview completes (default true). */
  draft?: boolean;
  /** Finish the interview first, skipping any open question. */
  finish?: boolean;
  /** Ask for the next round before entering the loop. */
  nextRound?: boolean;
}

/**
 * Continue a proposal from wherever it stands: interview at the terminal, then draft, critique,
 * and merge once the interview is complete.
 */
export async function continueProposal(
  sessionId: string,
  store: ResearchSessionStore,
  deps: CliDependencies,
  options: ContinueOptions = {}
): Promise<ProposalSession> {
  const renderer = deps.createProgressRenderer();
  try {
    return await withCouncilRuntime(deps.runtimeFactory(store), async ({ proposals }) => {
      let session = proposals.store.load(sessionId);
      if (options.finish && session.stage === 'awaiting-answers') {
        session = proposals.finishInterview(session.id);
      }
      if (options.nextRound && session.stage === 'awaiting-answers') {
        session = await proposals.nextRound(session.id, renderer.handle, options.signal);
      }
      if (session.stage === 'awaiting-answers') {
        session = await runInterviewLoop(proposals, session.id, deps.io, {
          answers: options.answers,
          progress: renderer.handle,
          signal: options.signal,
        });
      }
      if (session.stage === 'interview-complete' && options.draft !== false) {
        session = await proposals.draft(session.id, renderer.handle, options.signal);
      }
      return session;
    });
  } finally {
    renderer.finish();
  }
}

function sessionArgument(parsed: ParsedArguments): { sessionId?: string; rest: string[] } {
  const first = parsed.positionals[0];
  if (first && isProposalId(first)) return { sessionId: first, rest: parsed.positionals.slice(1) };
  return { sessionId: undefined, rest: parsed.positionals };
}

function outputSession(io: ShellIO, session: ProposalSession, json: boolean, text: string): void {
  io.out(json ? JSON.stringify(publicProposalSnapshot(session), null, 2) : text);
}

/** `hc propose ...`: a new proposal, or one of the subcommands operating on an existing one. */
export async function executePropose(
  args: string[],
  store: ResearchSessionStore,
  deps: CliDependencies,
  options: ProposeRunOptions = {}
): Promise<number> {
  const { io } = deps;
  const proposals: ProposalSessionStore = proposalStoreFor(store);
  const first = args[0];
  if (!first || first === 'help' || first === '--help') {
    io.out(PROPOSE_USAGE);
    return 0;
  }
  const { parseArguments } = await import('./arguments.js');
  if (!SUBCOMMANDS.has(first)) {
    const parsed = parseArguments(args);
    const json = hasFlag(parsed, '--json');
    const started = await startProposal(parsed, store, deps, options);
    if (!started) return 0;
    const session = await continueProposal(started.id, store, deps, {
      signal: options.signal,
      answers: parseAnswersFile(parsed, deps.cwd),
      draft: !hasFlag(parsed, '--no-draft'),
    });
    outputSession(
      io,
      session,
      json,
      session.proposal ? proposalSummaryText(session) : proposalStatusText(session)
    );
    return 0;
  }
  const parsed = parseArguments(args.slice(1));
  const json = hasFlag(parsed, '--json');
  const { sessionId, rest } = sessionArgument(parsed);
  switch (first) {
    case 'list': {
      const sessions = proposals.list();
      io.out(
        json
          ? JSON.stringify(sessions.map(publicProposalSnapshot), null, 2)
          : proposalsText(sessions)
      );
      return 0;
    }
    case 'status': {
      const session = proposals.load(sessionId);
      outputSession(io, session, json, proposalStatusText(session));
      return 0;
    }
    case 'questions': {
      const session = proposals.load(sessionId);
      io.out(questionsText(session, !hasFlag(parsed, '--all')));
      return 0;
    }
    case 'answer': {
      const session = proposals.load(sessionId);
      const answers = {
        ...parseAnswersFile(parsed, deps.cwd),
        ...parseInlineAnswers(rest, parsed),
      };
      if (Object.keys(answers).length === 0) throw new Error('No answers given.\n' + PROPOSE_USAGE);
      const updated = await withCouncilRuntime(deps.runtimeFactory(store), (runtime) =>
        Promise.resolve(runtime.proposals.answer(session.id, answers))
      );
      const open = openQuestions(updated).length;
      io.err(
        open > 0
          ? `${open} question${open === 1 ? '' : 's'} still open.`
          : updated.stage === 'interview-complete'
            ? 'Interview complete; run `hc propose draft`.'
            : 'All questions answered; run `hc propose next` for another round or `hc propose done`.'
      );
      outputSession(io, updated, json, proposalStatusText(updated));
      return 0;
    }
    case 'next':
    case 'done':
    case 'draft': {
      const session = proposals.load(sessionId);
      const updated = await continueProposal(session.id, store, deps, {
        signal: options.signal,
        answers: parseAnswersFile(parsed, deps.cwd),
        finish: first === 'done',
        nextRound: first === 'next',
        draft: first !== 'next' && !hasFlag(parsed, '--no-draft'),
      });
      outputSession(
        io,
        updated,
        json,
        updated.proposal ? proposalSummaryText(updated) : proposalStatusText(updated)
      );
      return 0;
    }
    case 'pick': {
      const draftId = rest[0];
      if (!draftId) throw new Error('Usage: hc propose pick [RP-SESSION] D-002');
      const session = proposals.load(sessionId);
      const updated = await withCouncilRuntime(deps.runtimeFactory(store), (runtime) =>
        Promise.resolve(runtime.proposals.pick(session.id, normalizeDraftId(draftId)))
      );
      outputSession(io, updated, json, proposalSummaryText(updated));
      return 0;
    }
    case 'show': {
      const session = proposals.load(sessionId);
      const draftId = rest[0];
      if (!draftId) {
        io.out(draftsText(session));
        return 0;
      }
      const draft = session.drafts.find((item) => item.id === normalizeDraftId(draftId));
      if (!draft) throw new Error(`Draft not found: ${draftId}`);
      io.out(renderDraftMarkdown(session, draft));
      return 0;
    }
    case 'report': {
      const session = proposals.load(sessionId);
      io.out(
        json
          ? JSON.stringify(createPublicProposalReport(session), null, 2)
          : renderProposalMarkdown(session)
      );
      return 0;
    }
    case 'ask': {
      const question = rest.join(' ');
      if (!question) throw new Error('Usage: hc propose ask [RP-SESSION] "<question>"');
      io.out(
        await withCouncilRuntime(deps.runtimeFactory(store), (runtime) =>
          runtime.proposals.ask(sessionId, question, flag(parsed, '--provider'), [], options.signal)
        )
      );
      return 0;
    }
    case 'resume': {
      const renderer = deps.createProgressRenderer();
      let session: ProposalSession;
      try {
        session = await withCouncilRuntime(deps.runtimeFactory(store), (runtime) =>
          runtime.proposals.resume(sessionId, renderer.handle, options.signal)
        );
      } finally {
        renderer.finish();
      }
      outputSession(
        io,
        session,
        json,
        session.proposal ? proposalSummaryText(session) : proposalStatusText(session)
      );
      return 0;
    }
    case 'handoff': {
      const outcome = await executeHandoff(parsed, sessionId, store, deps, options);
      outputSession(io, outcome.session, json, proposalStatusText(outcome.session));
      return outcome.result && outcome.result.status !== 'completed' ? 1 : 0;
    }
    default:
      throw new Error(`Unknown propose subcommand: ${first}\n\n${PROPOSE_USAGE}`);
  }
}
