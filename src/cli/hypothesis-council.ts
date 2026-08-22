#!/usr/bin/env node

import { lstatSync, readFileSync } from 'fs';
import { createInterface } from 'readline';
import { ResearchSessionStore } from '../research/store.js';
import { publicCandidateRecord, publicSessionSnapshot } from '../research/report.js';
import { createCouncilRuntime, withCouncilRuntime } from '../runtime.js';
import type {
  HypothesisCandidate,
  ResearchProgress,
  ResearchRunPreview,
  ResearchSession,
} from '../research/types.js';
import { createRunInput } from './run-options.js';

interface ParsedArguments {
  positionals: string[];
  flags: Map<string, string[]>;
}

const out = (value = '') => process.stdout.write(`${value}\n`);
const err = (value: string) => process.stderr.write(`${value}\n`);
const BOOLEAN_FLAGS = new Set(['--allow-single', '--help', '--json', '--markdown-only', '--yes']);

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

function stageLabel(session: ResearchSession): string {
  if (session.status === 'failed') return 'NEEDS ATTENTION';
  if (session.status === 'interrupted') return 'INTERRUPTED';
  if (session.status === 'completed') return 'COMPLETE';
  return session.stage.toUpperCase();
}

function statusText(session: ResearchSession): string {
  const distinct = session.candidates.filter((candidate) => candidate.status === 'distinct').length;
  const packetBytes = session.contextManifest.packetBytes ?? session.contextManifest.includedBytes;
  const lines = [
    `${session.id}  ${stageLabel(session)}`,
    `Goal: ${session.goal}`,
    `Providers: ${session.providers.length}/${session.config.providers.length} ready`,
    `Context: ${formatBytes(packetBytes)}/${formatBytes(session.config.maxContextBytes)}${session.config.markdownOnly ? ' · Markdown only' : ''}`,
    `Candidates: ${session.candidates.length} raw | ${distinct} distinct | ${session.reviews.length} reviewed | ${session.falsifications.length} falsified`,
  ];
  if (session.stage === 'generating' && session.candidates.length === 0) {
    lines.push('Candidates are sealed until independent generation completes.');
  }
  if (session.reportMarkdownPath) lines.push(`Report: ${session.reportMarkdownPath}`);
  if (session.error) lines.push(`Error: ${session.error}`);
  return lines.join('\n');
}

function orderedCandidates(session: ResearchSession): HypothesisCandidate[] {
  return session.candidates
    .filter((candidate) => candidate.status === 'distinct')
    .sort((left, right) => (left.rank || 999) - (right.rank || 999));
}

function candidatesText(session: ResearchSession): string {
  if (session.candidates.length === 0) {
    return 'Candidates are sealed until independent generation completes.';
  }
  const rows = orderedCandidates(session).map((candidate) => {
    const rank = candidate.rank ? `${candidate.rank}.` : '—';
    const score = candidate.score === undefined ? 'pending' : candidate.score.toFixed(2);
    return `${rank.padEnd(4)} ${candidate.id.padEnd(6)} ${candidate.title}  [review ${score}]`;
  });
  return [`Candidates for ${session.id}`, ...rows].join('\n');
}

function candidateText(session: ResearchSession, candidateId: string): string {
  const candidate = session.candidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
  const review = session.reviews.find((item) => item.hypothesisId === candidate.id);
  const attack = session.falsifications.find((item) => item.hypothesisId === candidate.id);
  return [
    `${candidate.id} — ${candidate.title}`,
    `Status: ${candidate.status}${candidate.duplicateOf ? ` of ${candidate.duplicateOf}` : ''}`,
    `Claim: ${candidate.claim}`,
    `Mechanism: ${candidate.mechanism}`,
    `Predictions: ${candidate.predictions.join('; ')}`,
    `Assumptions: ${candidate.assumptions.join('; ') || 'None recorded'}`,
    `Falsifier: ${candidate.falsifier}`,
    `Minimal experiment: ${candidate.minimalExperiment}`,
    `Review: ${review?.verdict || 'pending'}${review ? ` — ${review.strongestObjection}` : ''}`,
    `Adversarial attack: ${attack?.competingExplanation || 'not selected/pending'}`,
  ].join('\n');
}

function printProgress(progress: ResearchProgress): void {
  const fraction = progress.total > 0 ? ` ${progress.completed}/${progress.total}` : '';
  err(`[${progress.stage}]${fraction} ${progress.message}`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function printRunPreview(preview: ResearchRunPreview): void {
  const manifest = preview.contextManifest;
  const limit = preview.contextBudget.providerLimits.find(
    (provider) => provider.provider === preview.contextBudget.limitingProvider
  );
  err(`Repository: ${preview.contextRoot}`);
  err(`Providers: ${preview.providers.join(', ')}`);
  err(
    `Context mode: ${preview.markdownOnly ? 'Markdown files only' : 'supported text and code files'}`
  );
  err(
    `Shared context budget: ${formatBytes(preview.contextBudget.maxBytes)}; limited by ${preview.contextBudget.limitingProvider}${limit ? ` (${limit.model}, ${limit.contextWindowTokens.toLocaleString()} tokens${limit.transportLimited ? ', argument transport' : ''})` : ''}`
  );
  err(
    `Context preview: ${manifest.files.length} files contribute ${formatBytes(manifest.includedBytes)}; packet ${formatBytes(manifest.packetBytes)}/${formatBytes(manifest.maxBytes)}; denied ${manifest.deniedPaths.length}; omitted ${manifest.omittedPaths.length}`
  );
  for (const file of manifest.files.slice(0, 20)) {
    err(
      `  include ${file.path}${file.truncated ? ` (${formatBytes(file.includedBytes)} excerpt)` : ''}`
    );
  }
  if (manifest.files.length > 20)
    err(`  ...     ${manifest.files.length - 20} more included files`);
  for (const path of manifest.deniedPaths.slice(0, 20)) err(`  deny    ${path}`);
  if (manifest.deniedPaths.length > 20)
    err(`  ...     ${manifest.deniedPaths.length - 20} more denied paths`);
}

async function confirmRun(preview: ResearchRunPreview): Promise<void> {
  printRunPreview(preview);
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error(
      'Repository context is sent to external providers. Re-run with --yes after reviewing the preview.'
    );
  }
  const confirmation = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) =>
    confirmation.question('Send this context to the selected providers? [y/N] ', resolve)
  );
  confirmation.close();
  if (!/^y(?:es)?$/i.test(answer.trim())) throw new Error('Run cancelled');
}

function helpText(): string {
  return `Hypothesis Council

Usage:
  hc                                         Start the interactive shell
  hc run                                     Analyze the current repository
  hc run "<goal>" [--repo PATH] [--context PATH]... [--markdown-only] [--yes]
  hc run [--providers a,b] [--min-providers N] [--max-context-bytes N]
  hypothesis-council status [SESSION] [--json]
  hypothesis-council candidates [SESSION] [--json]
  hypothesis-council show H-001 [--session SESSION] [--json]
  hypothesis-council ask [SESSION] "<question>" [--provider NAME]
  hypothesis-council resume [SESSION]
  hypothesis-council report [SESSION]
  hypothesis-council sessions [--json]

Interactive commands:
  /run [goal]       Start a foreground council run for the current repository
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
  interactive = false,
  signal?: AbortSignal
): Promise<ResearchSession> {
  const contextPaths = flagValues(parsed, '--context');
  const maxContextBytes = numberFlag(parsed, '--max-context-bytes');
  const providerFlag = flag(parsed, '--providers');
  const repositoryPath = flag(parsed, '--repo');
  if (repositoryPath === 'true') throw new Error('--repo requires a directory path');
  const input = createRunInput({
    goalParts: parsed.positionals,
    contextPaths,
    repositoryPath,
    providers: providerFlag
      ?.split(',')
      .map((provider) => provider.trim())
      .filter(Boolean),
    hypothesesPerProvider: numberFlag(parsed, '--hypotheses'),
    topK: numberFlag(parsed, '--top-k'),
    minProviders:
      numberFlag(parsed, '--min-providers') ??
      (flag(parsed, '--allow-single') === 'true' ? 1 : undefined),
    seed: numberFlag(parsed, '--seed'),
    maxContextBytes,
    markdownOnly: flag(parsed, '--markdown-only') === 'true',
  });
  try {
    if (!input.contextRoot || !lstatSync(input.contextRoot).isDirectory()) throw new Error();
  } catch {
    throw new Error(`Repository directory not found: ${input.contextRoot || repositoryPath}`);
  }
  const automaticallyApproved = interactive || flag(parsed, '--yes') === 'true';
  return withCouncilRuntime(createCouncilRuntime(store), ({ service }) =>
    service.run(input, printProgress, signal, async (preview) => {
      if (automaticallyApproved) printRunPreview(preview);
      else await confirmRun(preview);
    })
  );
}

async function executeCommand(args: string[], store: ResearchSessionStore): Promise<void> {
  const command = args[0] || 'interactive';
  const parsed = parseArguments(args.slice(1));
  if (command === 'help' || flag(parsed, '--help') === 'true') {
    out(helpText());
    return;
  }
  if (command === 'interactive') {
    await runInteractive(store);
    return;
  }
  if (command === 'run') {
    const session = await runCommand(parsed, store);
    out(statusText(session));
    return;
  }
  if (command === 'status') {
    const session = store.load(parsed.positionals[0]);
    out(
      flag(parsed, '--json') === 'true'
        ? JSON.stringify(publicSessionSnapshot(session), null, 2)
        : statusText(session)
    );
    return;
  }
  if (command === 'candidates') {
    const session = store.load(parsed.positionals[0]);
    out(
      flag(parsed, '--json') === 'true'
        ? JSON.stringify(orderedCandidates(session).map(publicCandidateRecord), null, 2)
        : candidatesText(session)
    );
    return;
  }
  if (command === 'show') {
    const candidateId = parsed.positionals[0];
    if (!candidateId) throw new Error('Usage: hypothesis-council show H-001 [--session ID]');
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
      flag(parsed, '--json') === 'true'
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
      flag(parsed, '--json') === 'true'
        ? JSON.stringify(sessions.map(publicSessionSnapshot), null, 2)
        : sessions
            .map((session) => `${session.id}  ${stageLabel(session)}  ${session.goal}`)
            .join('\n') || 'No sessions yet.'
    );
    return;
  }
  if (command === 'report') {
    const session = store.load(parsed.positionals[0]);
    if (!session.reportMarkdownPath) throw new Error(`Report is not ready for ${session.id}`);
    out(readFileSync(session.reportMarkdownPath, 'utf8').trimEnd());
    return;
  }
  if (command === 'resume') {
    const session = await withCouncilRuntime(createCouncilRuntime(store), ({ service }) =>
      service.resume(parsed.positionals[0], printProgress)
    );
    out(statusText(session));
    return;
  }
  if (command === 'ask') {
    const first = parsed.positionals[0];
    const explicitSession = first?.startsWith('RC-') ? first : undefined;
    const question = parsed.positionals.slice(explicitSession ? 1 : 0).join(' ');
    if (!question) throw new Error('Usage: hypothesis-council ask [SESSION] "<question>"');
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
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let selectedSession = store.currentId();
  let selectedProvider: string | undefined;
  let chatHistory: string[] = [];
  let activeController: AbortController | undefined;
  let closing = false;

  out('Hypothesis Council · interactive rubber duck');
  out('Type /help for commands. Plain text chats; council runs are always explicit.');

  const prompt = () => {
    const scope = selectedSession || 'home';
    const duck = selectedProvider ? ` · ${selectedProvider}` : '';
    rl.setPrompt(`${scope}${duck}> `);
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
        out(candidateText(store.load(selectedSession), line.slice(6).trim()));
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
        const session = store.load(selectedSession);
        if (!session.reportMarkdownPath) throw new Error(`Report is not ready for ${session.id}`);
        out(readFileSync(session.reportMarkdownPath, 'utf8').trimEnd());
        return;
      }
      if (line === '/resume') {
        activeController = new AbortController();
        const session = await withCouncilRuntime(createCouncilRuntime(store), ({ service }) =>
          service.resume(selectedSession, printProgress, activeController?.signal)
        );
        selectedSession = session.id;
        out(statusText(session));
        return;
      }
      if (line === '/run' || line.startsWith('/run ')) {
        activeController = new AbortController();
        const goal = line.slice(4).trim();
        const parsed = parseArguments(goal ? [goal] : []);
        const session = await runCommand(parsed, store, true, activeController.signal);
        selectedSession = session.id;
        out(statusText(session));
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
        err(`Error: ${error instanceof Error ? error.message : String(error)}`);
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
}

const store = new ResearchSessionStore();
executeCommand(process.argv.slice(2), store).catch((error: unknown) => {
  err(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
