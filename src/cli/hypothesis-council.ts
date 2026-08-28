#!/usr/bin/env node

import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { createInterface } from 'readline';
import { ResearchSessionStore } from '../research/store.js';
import { publicCandidateRecord, publicSessionSnapshot } from '../research/report.js';
import { createCouncilRuntime, withCouncilRuntime } from '../runtime.js';
import { installedRubberDuckVersion } from '../rubber-duck/launch.js';
import type { ResearchRunPreview, ResearchSession } from '../research/types.js';
import { doctorText, runDoctor } from './doctor.js';
import {
  candidateText,
  candidatesText,
  errorHints,
  normalizeCandidateId,
  orderedCandidates,
  runPreviewLines,
  runSummaryText,
  stageLabel,
  statusText,
} from './format.js';
import { loadShellHistory, rememberShellLine, saveShellHistory } from './history.js';
import {
  applyPreset,
  findPreset,
  missingPresetCommands,
  presetsText,
  type CouncilPreset,
} from './presets.js';
import { createProgressRenderer, type ProgressRenderer } from './progress.js';
import { createRunInput } from './run-options.js';

interface ParsedArguments {
  positionals: string[];
  flags: Map<string, string[]>;
}

interface RunOutcome {
  session: ResearchSession;
  elapsedMs: number;
}

const out = (value = '') => process.stdout.write(`${value}\n`);
const err = (value: string) => process.stderr.write(`${value}\n`);
const BOOLEAN_FLAGS = new Set([
  '--allow-single',
  '--dry-run',
  '--help',
  '--json',
  '--markdown-only',
  '--probe',
  '--yes',
]);

function parseArguments(args: string[]): ParsedArguments {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const [name, inline] = value.split('=', 2);
    const next = args[index + 1];
    const flagValue =
      inline ??
      (!BOOLEAN_FLAGS.has(name) && next && !next.startsWith('--') ? args[++index] : 'true');
    flags.set(name, [...(flags.get(name) || []), flagValue]);
  }
  return { positionals, flags };
}

function flag(parsed: ParsedArguments, name: string): string | undefined {
  return parsed.flags.get(name)?.at(-1);
}

function flagValues(parsed: ParsedArguments, name: string): string[] {
  return parsed.flags.get(name) || [];
}

function numberFlag(parsed: ParsedArguments, name: string): number | undefined {
  const value = flag(parsed, name);
  if (value === undefined) return undefined;
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${name} must be a number`);
  return result;
}

function pathFlag(parsed: ParsedArguments, name: string): string | undefined {
  const value = flag(parsed, name);
  if (value === 'true') throw new Error(`${name} requires a path`);
  return value;
}

function progressRenderer(): ProgressRenderer {
  const live =
    process.stderr.isTTY === true && process.env.HYPOTHESIS_COUNCIL_PLAIN_PROGRESS !== 'true';
  return createProgressRenderer({
    write: (text) => void process.stderr.write(text),
    live,
    columns: process.stderr.columns,
  });
}

function printRunPreview(preview: ResearchRunPreview): void {
  for (const line of runPreviewLines(preview)) err(line);
}

async function confirmRun(preview: ResearchRunPreview): Promise<void> {
  printRunPreview(preview);
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error(
      'Repository context is sent to external providers. Re-run with --yes after reviewing the preview, or use --dry-run to inspect it.'
    );
  }
  const confirmation = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) =>
    confirmation.question('Send this context to the selected providers? [y/N] ', resolve)
  );
  confirmation.close();
  if (!/^y(?:es)?$/i.test(answer.trim())) throw new Error('Run cancelled');
}

/**
 * Apply `--preset NAME` to the process environment before any Rubber Duck subprocess starts.
 * With `strict`, missing vendor CLIs abort early instead of failing minutes later in preflight.
 */
function selectPreset(parsed: ParsedArguments, strict: boolean): CouncilPreset | undefined {
  const name = flag(parsed, '--preset');
  if (name === undefined) return undefined;
  if (name === 'true') throw new Error('--preset requires a name; run `hc presets` to list them');
  const preset = findPreset(name);
  const missing = missingPresetCommands(preset);
  if (strict && missing.length > 0) {
    throw new Error(
      `Preset ${preset.name} needs these commands on PATH: ${missing.join(', ')}. Run \`hc doctor --preset ${preset.name}\` for details.`
    );
  }
  applyPreset(preset, process.env);
  return preset;
}

function resolveOutputPath(target: string, defaultName: string): string {
  const absolute = resolve(target);
  const isDirectory =
    /[\\/]$/.test(target) || (existsSync(absolute) && statSync(absolute).isDirectory());
  return isDirectory ? join(absolute, defaultName) : absolute;
}

function copyReport(session: ResearchSession, target: string, json = false): string {
  const source = json ? session.reportJsonPath : session.reportMarkdownPath;
  if (!source) throw new Error(`Report is not ready for ${session.id}`);
  const path = resolveOutputPath(target, `${session.id}.${json ? 'json' : 'md'}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, readFileSync(source, 'utf8'));
  return path;
}

function reportText(session: ResearchSession, json: boolean): string {
  const source = json ? session.reportJsonPath : session.reportMarkdownPath;
  if (!source) throw new Error(`Report is not ready for ${session.id}`);
  return readFileSync(source, 'utf8').trimEnd();
}

function helpText(): string {
  return `Hypothesis Council

Usage:
  hc                                         Start the interactive shell
  hc doctor [--probe] [--preset NAME] [--json]
                                             Check providers, models, transports, and CLIs
  hc presets                                 List ready-made council presets
  hc run                                     Analyze the current repository
  hc run "<goal>" [--repo PATH] [--context PATH]... [--markdown-only] [--yes]
  hc run [--preset NAME] [--providers a,b] [--min-providers N] [--max-context-bytes N]
  hc run [--dry-run] [--out PATH] [--json]   Preview only / copy the report / machine output
  hc status [SESSION] [--json]
  hc candidates [SESSION] [--json]
  hc show H-001 [--session SESSION] [--json] (H1 and 1 are accepted too)
  hc ask [SESSION] "<question>" [--provider NAME]
  hc resume [SESSION]
  hc report [SESSION] [--json] [--out PATH]
  hc sessions [--json]

Interactive commands:
  /run [goal]       Start a foreground council run for the current repository
  /preset NAME      Use a council preset for later /run commands
  /doctor           Check provider configuration
  /status           View current progress
  /candidates       List visible candidates
  /show H-001       Inspect a candidate and its criticism
  /use SESSION      Select a persisted session
  /duck PROVIDER    Select the conversational duck
  /resume           Resume from the last durable stage
  /report           Show the Markdown report
  /sessions         List sessions
  /help             Show commands
  /exit             Exit (an active run is interrupted and checkpointed)

Plain text asks the selected duck a question. When a session is selected, answers are grounded in its persisted candidates and do not mutate rankings.`;
}

async function runCommand(
  parsed: ParsedArguments,
  store: ResearchSessionStore,
  options: { interactive?: boolean; signal?: AbortSignal; preset?: CouncilPreset } = {}
): Promise<RunOutcome | undefined> {
  const preset = options.preset ?? selectPreset(parsed, true);
  const contextPaths = flagValues(parsed, '--context');
  const maxContextBytes = numberFlag(parsed, '--max-context-bytes');
  const providerFlag = flag(parsed, '--providers');
  const repositoryPath = pathFlag(parsed, '--repo');
  const input = createRunInput({
    goalParts: parsed.positionals,
    contextPaths,
    repositoryPath,
    providers:
      providerFlag
        ?.split(',')
        .map((provider) => provider.trim())
        .filter(Boolean) ?? preset?.providers,
    hypothesesPerProvider: numberFlag(parsed, '--hypotheses'),
    topK: numberFlag(parsed, '--top-k'),
    minProviders:
      numberFlag(parsed, '--min-providers') ??
      (flag(parsed, '--allow-single') === 'true' ? 1 : preset?.minProviders),
    seed: numberFlag(parsed, '--seed'),
    maxContextBytes,
    markdownOnly: flag(parsed, '--markdown-only') === 'true',
  });
  try {
    if (!input.contextRoot || !lstatSync(input.contextRoot).isDirectory()) throw new Error();
  } catch {
    throw new Error(`Repository directory not found: ${input.contextRoot || repositoryPath}`);
  }
  if (preset) err(`Preset: ${preset.name}`);

  if (flag(parsed, '--dry-run') === 'true') {
    const preview = await withCouncilRuntime(createCouncilRuntime(store), ({ service }) =>
      service.preview(input, options.signal)
    );
    printRunPreview(preview);
    err('Dry run: no session was created and nothing was sent to a provider.');
    return undefined;
  }

  const automaticallyApproved = options.interactive || flag(parsed, '--yes') === 'true';
  const renderer = progressRenderer();
  const startedAt = Date.now();
  try {
    const session = await withCouncilRuntime(createCouncilRuntime(store), ({ service }) =>
      service.run(input, renderer.handle, options.signal, async (preview) => {
        if (automaticallyApproved) printRunPreview(preview);
        else await confirmRun(preview);
      })
    );
    return { session, elapsedMs: Date.now() - startedAt };
  } finally {
    renderer.finish();
  }
}

async function executeCommand(args: string[], store: ResearchSessionStore): Promise<void> {
  const command = args[0] || 'interactive';
  const parsed = parseArguments(args.slice(1));
  const json = flag(parsed, '--json') === 'true';
  if (command === 'help' || flag(parsed, '--help') === 'true') {
    out(helpText());
    return;
  }
  if (command === 'interactive') {
    await runInteractive(store);
    return;
  }
  if (command === 'presets') {
    out(presetsText());
    return;
  }
  if (command === 'doctor') {
    const preset = selectPreset(parsed, false);
    const report = await withCouncilRuntime(createCouncilRuntime(store), ({ gateway }) =>
      runDoctor({
        gateway,
        workingDirectory: store.sessionDirectory('doctor'),
        sessionHome: store.root,
        probe: flag(parsed, '--probe') === 'true',
        rubberDuckVersion: installedRubberDuckVersion(),
      })
    );
    if (preset) {
      const missing = missingPresetCommands(preset);
      for (const command of missing) {
        const message = `Preset ${preset.name} requires "${command}", which is not on PATH.`;
        if (!report.problems.includes(message)) report.problems.push(message);
      }
    }
    out(
      json
        ? JSON.stringify(report, null, 2)
        : `${preset ? `Preset: ${preset.name}\n` : ''}${doctorText(report)}`
    );
    if (report.problems.length > 0) process.exitCode = 1;
    return;
  }
  if (command === 'run') {
    const outcome = await runCommand(parsed, store);
    if (!outcome) return;
    const outPath = pathFlag(parsed, '--out');
    const copiedReportPath = outPath ? copyReport(outcome.session, outPath) : undefined;
    out(
      json
        ? JSON.stringify(publicSessionSnapshot(outcome.session), null, 2)
        : runSummaryText(outcome.session, { elapsedMs: outcome.elapsedMs, copiedReportPath })
    );
    return;
  }
  if (command === 'status') {
    const session = store.load(parsed.positionals[0]);
    out(json ? JSON.stringify(publicSessionSnapshot(session), null, 2) : statusText(session));
    return;
  }
  if (command === 'candidates') {
    const session = store.load(parsed.positionals[0]);
    out(
      json
        ? JSON.stringify(orderedCandidates(session).map(publicCandidateRecord), null, 2)
        : candidatesText(session)
    );
    return;
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
    out(
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
    return;
  }
  if (command === 'sessions') {
    const sessions = store.list();
    out(
      json
        ? JSON.stringify(sessions.map(publicSessionSnapshot), null, 2)
        : sessions
            .map((session) => `${session.id}  ${stageLabel(session)}  ${session.goal}`)
            .join('\n') || 'No sessions yet.'
    );
    return;
  }
  if (command === 'report') {
    const session = store.load(parsed.positionals[0]);
    const outPath = pathFlag(parsed, '--out');
    if (outPath) {
      out(`Report copied to: ${copyReport(session, outPath, json)}`);
      return;
    }
    out(reportText(session, json));
    return;
  }
  if (command === 'resume') {
    const renderer = progressRenderer();
    const startedAt = Date.now();
    let session: ResearchSession;
    try {
      session = await withCouncilRuntime(createCouncilRuntime(store), ({ service }) =>
        service.resume(parsed.positionals[0], renderer.handle)
      );
    } finally {
      renderer.finish();
    }
    out(
      json
        ? JSON.stringify(publicSessionSnapshot(session), null, 2)
        : runSummaryText(session, { elapsedMs: Date.now() - startedAt })
    );
    return;
  }
  if (command === 'ask') {
    const first = parsed.positionals[0];
    const explicitSession = first?.startsWith('RC-') ? first : undefined;
    const question = parsed.positionals.slice(explicitSession ? 1 : 0).join(' ');
    if (!question) throw new Error('Usage: hc ask [SESSION] "<question>"');
    out(
      await withCouncilRuntime(createCouncilRuntime(store), ({ service }) =>
        service.ask(explicitSession, question, flag(parsed, '--provider'))
      )
    );
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${helpText()}`);
}

async function runInteractive(store: ResearchSessionStore): Promise<void> {
  const historyPath = join(store.root, 'shell-history');
  let history = loadShellHistory(historyPath);
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    history,
    removeHistoryDuplicates: true,
  });
  let selectedSession = store.currentId();
  let selectedProvider: string | undefined;
  let selectedPreset: CouncilPreset | undefined;
  let chatHistory: string[] = [];
  let activeController: AbortController | undefined;
  let closing = false;

  out('Hypothesis Council · interactive rubber duck');
  out('Type /help for commands. Plain text chats; council runs are always explicit.');

  const prompt = () => {
    const scope = selectedSession || 'home';
    const duck = selectedProvider ? ` · ${selectedProvider}` : '';
    const preset = selectedPreset ? ` · ${selectedPreset.name}` : '';
    rl.setPrompt(`${scope}${duck}${preset}> `);
    rl.prompt();
  };

  rl.on('SIGINT', () => {
    if (activeController) {
      err('Interrupting the active provider call; completed stages remain checkpointed.');
      activeController.abort();
    } else {
      out('');
      prompt();
    }
  });

  rl.on('line', (rawLine) => {
    rl.pause();
    void (async () => {
      const line = rawLine.trim();
      if (!line) return;
      history = rememberShellLine(history, line);
      if (line === '/exit') {
        activeController?.abort();
        closing = true;
        rl.close();
        return;
      }
      if (line === '/help') {
        out(helpText());
        return;
      }
      if (line === '/status') {
        out(statusText(store.load(selectedSession)));
        return;
      }
      if (line === '/candidates') {
        out(candidatesText(store.load(selectedSession)));
        return;
      }
      if (line.startsWith('/show ')) {
        out(candidateText(store.load(selectedSession), normalizeCandidateId(line.slice(6))));
        return;
      }
      if (line === '/sessions') {
        out(
          store
            .list()
            .map((session) => `${session.id}  ${stageLabel(session)}  ${session.goal}`)
            .join('\n') || 'No sessions yet.'
        );
        return;
      }
      if (line === '/presets') {
        out(presetsText());
        return;
      }
      if (line.startsWith('/preset ')) {
        const preset = findPreset(line.slice(8).trim());
        const missing = missingPresetCommands(preset);
        if (missing.length > 0) {
          throw new Error(
            `Preset ${preset.name} needs these commands on PATH: ${missing.join(', ')}`
          );
        }
        applyPreset(preset, process.env);
        selectedPreset = preset;
        out(`Preset ${preset.name}: ${preset.providers.join(', ')}`);
        return;
      }
      if (line === '/doctor') {
        activeController = new AbortController();
        const report = await withCouncilRuntime(createCouncilRuntime(store), ({ gateway }) =>
          runDoctor({
            gateway,
            workingDirectory: store.sessionDirectory('doctor'),
            sessionHome: store.root,
            rubberDuckVersion: installedRubberDuckVersion(),
            signal: activeController?.signal,
          })
        );
        out(doctorText(report));
        return;
      }
      if (line.startsWith('/use ')) {
        selectedSession = store.use(line.slice(5).trim()).id;
        chatHistory = [];
        out(`Using ${selectedSession}`);
        return;
      }
      if (line.startsWith('/duck ')) {
        selectedProvider = line.slice(6).trim();
        chatHistory = [];
        out(`Conversational duck: ${selectedProvider}`);
        return;
      }
      if (line === '/report') {
        out(reportText(store.load(selectedSession), false));
        return;
      }
      if (line === '/resume') {
        activeController = new AbortController();
        const renderer = progressRenderer();
        const startedAt = Date.now();
        let session: ResearchSession;
        try {
          session = await withCouncilRuntime(createCouncilRuntime(store), ({ service }) =>
            service.resume(selectedSession, renderer.handle, activeController?.signal)
          );
        } finally {
          renderer.finish();
        }
        selectedSession = session.id;
        out(runSummaryText(session, { elapsedMs: Date.now() - startedAt }));
        return;
      }
      if (line === '/run' || line.startsWith('/run ')) {
        activeController = new AbortController();
        const goal = line.slice(4).trim();
        const parsed = parseArguments(goal ? [goal] : []);
        const outcome = await runCommand(parsed, store, {
          interactive: true,
          signal: activeController.signal,
          preset: selectedPreset,
        });
        if (!outcome) return;
        selectedSession = outcome.session.id;
        out(runSummaryText(outcome.session, { elapsedMs: outcome.elapsedMs }));
        return;
      }
      if (line.startsWith('/')) throw new Error(`Unknown interactive command: ${line}`);

      activeController = new AbortController();
      const answer = await withCouncilRuntime(
        createCouncilRuntime(store),
        async ({ service, gateway }) => {
          if (selectedSession) {
            return service.ask(
              selectedSession,
              line,
              selectedProvider,
              chatHistory,
              activeController?.signal
            );
          }
          const workingDirectory = store.sessionDirectory('chat');
          const providers = await gateway.listProviders(workingDirectory, activeController?.signal);
          const provider =
            selectedProvider ||
            providers.find((item) => item.type === 'cli')?.name ||
            providers[0]?.name;
          if (!provider) throw new Error('No Rubber Duck provider is configured');
          const completion = await gateway.complete(
            provider,
            [...chatHistory.slice(-6), `User: ${line}`].join('\n'),
            { workingDirectory, signal: activeController?.signal }
          );
          selectedProvider = provider;
          return completion.content;
        }
      );
      out(answer);
      chatHistory.push(`User: ${line}`, `Duck: ${answer}`);
    })()
      .catch((error: unknown) => {
        reportError(error);
      })
      .finally(() => {
        activeController = undefined;
        if (!closing) {
          rl.resume();
          prompt();
        }
      });
  });

  prompt();
  await new Promise<void>((resolve) => rl.once('close', resolve));
  saveShellHistory(historyPath, history);
}

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  err(`Error: ${message}`);
  for (const hint of errorHints(message)) err(`Hint: ${hint}`);
}

const store = new ResearchSessionStore();
executeCommand(process.argv.slice(2), store).catch((error: unknown) => {
  reportError(error);
  process.exitCode = 1;
});
