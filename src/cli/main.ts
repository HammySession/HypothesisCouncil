import { join } from 'path';
import { createInterface } from 'readline';
import { publicCandidateRecord, publicSessionSnapshot } from '../research/report.js';
import type { ResearchSessionStore } from '../research/store.js';
import type { ResearchSession } from '../research/types.js';
import { withCouncilRuntime } from '../runtime.js';
import { VERSION } from '../version.js';
import { isProposalId } from '../research/proposal/store.js';
import { executePropose } from './propose-command.js';
import { flag, hasFlag, parseArguments, pathFlag } from './arguments.js';
import type { CliDependencies } from './dependencies.js';
import { executeDoctor } from './doctor-command.js';
import { executeModels } from './models-command.js';
import { doctorText } from './doctor.js';
import {
  candidateText,
  candidatesText,
  errorHints,
  normalizeCandidateId,
  orderedCandidates,
  runSummaryText,
  sessionsText,
  statusText,
} from './format.js';
import { loadShellHistory, rememberShellLine, saveShellHistory } from './history.js';
import { describeModels, presetsText } from './presets.js';
import { defaultPresetName, selectPreset } from './preset-selection.js';
import { copyReport, reportText, renderSessionHtml, writeHtmlReport } from './report-files.js';
import { executeReports, executeTag, openReport } from './reports-command.js';
import { runCommand } from './run-command.js';
import { currentDials, executeSettings, resolveStoreSettings } from './settings-command.js';
import { settingsExtras } from './settings-extras.js';
import { parseSettingsArgs } from './settings-view.js';
import { SHELL_COMMANDS } from './shell/commands/index.js';
import { createShellCompleter, type ShellCompleter } from './shell/completer.js';
import { createShellState, promptText, type ShellContext } from './shell/context.js';
import { shellHelpText } from './shell/help.js';
import { createTerminalIO, type InputStream, type OutputStream } from './shell/io.js';
import { dispatchShellLine } from './shell/registry.js';

/** `hc status RP-...` and friends route to the matching `hc propose` subcommand. */
const PROPOSAL_ROUTED_COMMANDS = new Set(['status', 'report', 'resume', 'ask']);

export function cliHelpText(): string {
  return `Hypothesis Council ${VERSION}

Start here:
  hc doctor                                  Check which AI CLIs the council can use
  hc run "<goal>" --dry-run                  Preview what a run would send, without sending it
  hc run "<goal>" --yes                      Run the council on the current repository
  hc report --html --open                    Open the latest report in your browser
  hc                                         Start the interactive shell (type /help there)

Council runs:
  hc run "<goal>" [--repo PATH] [--context PATH|GLOB]... [--markdown-only] [--yes]
                                             --context accepts files, directories, and globs
                                             such as "src/**/*.ts"
  hc run [--preset NAME] [--providers a,b] [--min-providers N] [--max-context-bytes N]
  hc run [--novelty LEVEL] [--skepticism LEVEL]
                                             LEVEL is 0-10 or low, medium, high (default 5)
  hc run [--model KEY=ID]... [--model-policy latest|pinned] [--refresh]
                                             Pin a preset slot, or stop auto-selecting models
  hc run [--sources FILE] [--scouts a,b] [--web auto|on|off]
                                             Cite a sources file (JSON or Markdown); web scouts
                                             propose more; --web off keeps the run offline
  hc run [--dry-run] [--out PATH] [--json]   Preview only / copy the report / machine output
  hc resume [SESSION]                        Continue a run from its last completed stage

Providers and settings:
  hc doctor [--probe] [--preset NAME] [--json]
                                             Check providers, models, transports, and CLIs
  hc presets                                 List the council presets (auto, quick, frontier)
  hc models [--preset NAME] [--refresh] [--json]
                                             Show the model each preset slot resolves to
  hc settings [--json] [--providers]         Show effective settings, preset models, and (with
                                             --providers) the configured providers
  hc settings set KEY VALUE | unset KEY | path | reset | help
                                             Edit <session home>/settings.json

Results:
  hc status [SESSION] [--json]
  hc candidates [SESSION] [--json]
  hc show H-001 [--session SESSION] [--json] (H1 and 1 are accepted too)
  hc ask [SESSION] "<question>" [--provider NAME]
  hc report [SESSION] [--json] [--out PATH] [--html] [--open]
  hc reports [--filter TEXT] [--tag TAG] [--json] [--html [--open]]
                                             List saved reports; --html writes the gallery to
                                             <session home>/index.html
  hc open N|SESSION|index                    Open one report (or the gallery) in the browser
  hc tag [SESSION] add a,b | rm a | title TEXT | clear | show
  hc sessions [--json]

Research proposals:
  hc propose "<topic>" [--repo PATH] [--context PATH|GLOB]... [--from RC-SESSION] [--yes]
                                             The council interviews you, drafts independently,
                                             critiques blind, and merges one proposal
  hc propose list | status | questions | answer | next | done | draft | pick | show | report
  hc propose ask | resume | handoff --to claude|codex|agy|grok [--run]
                                             hc propose help lists every subcommand and flag

Other:
  hc --version                               Print the version
  hc help                                    Print this text

${shellHelpText(SHELL_COMMANDS)}`;
}

export function reportError(io: CliDependencies['io'], error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  io.err(`Error: ${message}`);
  for (const hint of errorHints(message)) io.err(`Hint: ${hint}`);
}

/**
 * Run one `hc` command. Resolves to the process exit code; errors propagate so the entry point can
 * print them with hints.
 */
export async function executeCommand(
  args: string[],
  store: ResearchSessionStore,
  deps: CliDependencies
): Promise<number> {
  const first = args[0] || 'interactive';
  const { io } = deps;
  if (first === '--version' || first === '-v' || first === 'version') {
    io.out(VERSION);
    return 0;
  }
  const command = first === '--help' || first === '-h' ? 'help' : first;
  const parsed = parseArguments(args.slice(1));
  const json = hasFlag(parsed, '--json');
  if (command === 'propose') {
    return executePropose(args.slice(1), store, deps);
  }
  if (command === 'handoff') {
    return executePropose(['handoff', ...args.slice(1)], store, deps);
  }
  if (
    PROPOSAL_ROUTED_COMMANDS.has(command) &&
    parsed.positionals[0] &&
    isProposalId(parsed.positionals[0])
  ) {
    return executePropose([command, ...args.slice(1)], store, deps);
  }
  if (command === 'help' || hasFlag(parsed, '--help')) {
    io.out(cliHelpText());
    return 0;
  }
  if (command === 'interactive') {
    await runInteractive(store, deps);
    return 0;
  }
  if (command === 'presets') {
    io.out(presetsText());
    return 0;
  }
  if (command === 'settings') {
    const words = args.slice(1).filter((word) => word !== '--providers');
    const action = parseSettingsArgs(words);
    const extras =
      action.kind === 'show'
        ? await settingsExtras(store, deps, { providers: args.includes('--providers') })
        : [];
    return executeSettings(action, store, deps, extras);
  }
  if (command === 'models') {
    return executeModels(parsed, store, deps);
  }
  if (command === 'doctor') {
    const { report, preset, models } = await executeDoctor(parsed, store, deps);
    const header = preset
      ? `Preset: ${preset.name}${models && preset.modelSlots?.length ? ` · models: ${describeModels(preset, models)}` : ''}\n`
      : '';
    io.out(
      json ? JSON.stringify({ ...report, models }, null, 2) : `${header}${doctorText(report)}`
    );
    return report.problems.length > 0 ? 1 : 0;
  }
  if (command === 'run') {
    const outcome = await runCommand(parsed, store, deps);
    if (!outcome) return 0;
    const outPath = pathFlag(parsed, '--out');
    const copiedReportPath = outPath
      ? copyReport(outcome.session, outPath, false, deps.cwd)
      : undefined;
    io.out(
      json
        ? JSON.stringify(publicSessionSnapshot(outcome.session), null, 2)
        : runSummaryText(outcome.session, { elapsedMs: outcome.elapsedMs, copiedReportPath })
    );
    return 0;
  }
  if (command === 'status') {
    const session = store.load(parsed.positionals[0]);
    io.out(json ? JSON.stringify(publicSessionSnapshot(session), null, 2) : statusText(session));
    return 0;
  }
  if (command === 'candidates') {
    const session = store.load(parsed.positionals[0]);
    io.out(
      json
        ? JSON.stringify(orderedCandidates(session).map(publicCandidateRecord), null, 2)
        : candidatesText(session)
    );
    return 0;
  }
  if (command === 'show') {
    if (!parsed.positionals[0]) throw new Error('Usage: hc show H-001 [--session ID]');
    const candidateId = normalizeCandidateId(parsed.positionals[0]);
    const session = store.load(flag(parsed, '--session'));
    const candidate = session.candidates.find((item) => item.id === candidateId);
    if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
    const review = session.reviews.find((item) => item.hypothesisId === candidate.id);
    const falsification = session.falsifications.find((item) => item.hypothesisId === candidate.id);
    const visibleReview = review
      ? (({ reviewerProvider: _reviewer, ...visible }) => visible)(review)
      : undefined;
    const visibleFalsification = falsification
      ? (({ reviewerProvider: _reviewer, ...visible }) => visible)(falsification)
      : undefined;
    io.out(
      json
        ? JSON.stringify(
            {
              ...publicCandidateRecord(candidate),
              review: visibleReview,
              falsification: visibleFalsification,
            },
            null,
            2
          )
        : candidateText(session, candidateId)
    );
    return 0;
  }
  if (command === 'sessions') {
    const sessions = store.list();
    io.out(
      json ? JSON.stringify(sessions.map(publicSessionSnapshot), null, 2) : sessionsText(sessions)
    );
    return 0;
  }
  if (command === 'report') {
    const session = store.load(parsed.positionals[0]);
    const outPath = pathFlag(parsed, '--out');
    const html = hasFlag(parsed, '--html') || hasFlag(parsed, '--open');
    if (html) {
      if (json) throw new Error('--html/--open cannot be combined with --json');
      const target = outPath
        ? writeHtmlReport(session, outPath, deps.cwd)
        : store.writeReport(session.id, 'report.html', renderSessionHtml(session));
      io.out(`HTML report: ${target}`);
      if (hasFlag(parsed, '--open')) deps.openInBrowser(target);
      return 0;
    }
    if (outPath) {
      io.out(`Report copied to: ${copyReport(session, outPath, json, deps.cwd)}`);
      return 0;
    }
    io.out(reportText(session, json));
    return 0;
  }
  if (command === 'reports') {
    return executeReports(parsed, store, deps);
  }
  if (command === 'open') {
    if (!parsed.positionals[0]) throw new Error('Usage: hc open N|SESSION|index');
    openReport(parsed.positionals[0], store, deps);
    return 0;
  }
  if (command === 'tag') {
    return executeTag(args.slice(1), store, io);
  }
  if (command === 'resume') {
    const renderer = deps.createProgressRenderer();
    const startedAt = deps.now();
    let session: ResearchSession;
    try {
      session = await withCouncilRuntime(deps.runtimeFactory(store), ({ service }) =>
        service.resume(parsed.positionals[0], renderer.handle)
      );
    } finally {
      renderer.finish();
    }
    io.out(
      json
        ? JSON.stringify(publicSessionSnapshot(session), null, 2)
        : runSummaryText(session, { elapsedMs: deps.now() - startedAt })
    );
    return 0;
  }
  if (command === 'ask') {
    const first = parsed.positionals[0];
    const explicitSession = first?.startsWith('RC-') ? first : undefined;
    const question = parsed.positionals.slice(explicitSession ? 1 : 0).join(' ');
    if (!question) throw new Error('Usage: hc ask [SESSION] "<question>"');
    io.out(
      await withCouncilRuntime(deps.runtimeFactory(store), ({ service }) =>
        service.ask(explicitSession, question, flag(parsed, '--provider'))
      )
    );
    return 0;
  }
  throw new Error(`Unknown command: ${command}\n\n${cliHelpText()}`);
}

/**
 * Seat the council the shell will use: the settings default, or the auto preset when the person
 * configured no provider themselves. A preset that cannot run is reported, not fatal.
 */
async function applyStartupPreset(ctx: ShellContext): Promise<void> {
  try {
    const settings = resolveStoreSettings(ctx.store, ctx.env);
    const name = defaultPresetName(settings, ctx);
    if (!name) return;
    const selected = await selectPreset(parseArguments([]), true, ctx, {
      store: ctx.store,
      settings,
      defaultName: name,
    });
    if (!selected) return;
    ctx.state.preset = selected.preset;
    ctx.io.out(`Preset ${selected.preset.name}: ${selected.preset.providers.join(', ')}`);
  } catch (error) {
    reportError(ctx.io, error);
  }
}

export interface InteractiveStreams {
  stdin: InputStream;
  stdout: OutputStream;
  stderr: OutputStream;
}

/** The interactive shell: one readline loop, one abort controller per line, persisted history. */
export async function runInteractive(
  store: ResearchSessionStore,
  deps: CliDependencies,
  streams: InteractiveStreams = {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  }
): Promise<void> {
  const historyPath = join(store.root, 'shell-history');
  let history = loadShellHistory(historyPath);
  let complete: ShellCompleter = (line) => [[], line];
  const rl = createInterface({
    input: streams.stdin,
    output: streams.stdout,
    history,
    removeHistoryDuplicates: true,
    completer: (line: string) => complete(line),
  });
  const io = createTerminalIO({ ...streams, rl });
  const ctx: ShellContext = { ...deps, io, store, state: createShellState(store, deps.cwd) };
  complete = createShellCompleter(ctx, () => SHELL_COMMANDS);
  try {
    ctx.state.dials = currentDials(store, deps.env);
  } catch (error) {
    // An unreadable settings file must not lock the person out of the shell.
    reportError(io, error);
  }
  let activeController: AbortController | undefined;

  io.out(`Hypothesis Council ${VERSION}`);
  io.out('Type /help for commands. Plain text chats with a provider; /run starts a council run.');
  await applyStartupPreset(ctx);

  const prompt = () => {
    rl.setPrompt(promptText(ctx.state));
    rl.prompt();
  };

  rl.on('SIGINT', () => {
    if (activeController) {
      io.err('Interrupting the active provider call; completed stages remain checkpointed.');
      activeController.abort();
    } else {
      io.out('');
      prompt();
    }
  });

  rl.on('line', (rawLine) => {
    rl.pause();
    const line = rawLine.trim();
    const controller = new AbortController();
    activeController = controller;
    void (async () => {
      if (!line) return;
      history = rememberShellLine(history, line);
      await dispatchShellLine({ ...ctx, signal: controller.signal }, line);
    })()
      .catch((error: unknown) => reportError(io, error))
      .finally(() => {
        activeController = undefined;
        if (ctx.state.closing) {
          rl.close();
        } else {
          rl.resume();
          prompt();
        }
      });
  });

  prompt();
  await new Promise<void>((resolve) => rl.once('close', resolve));
  saveShellHistory(historyPath, history);
}
