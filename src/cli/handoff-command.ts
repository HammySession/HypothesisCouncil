import { copyFileSync, lstatSync } from 'fs';
import { join, resolve } from 'path';
import {
  describeExecutorLaunch,
  executorTimeoutMs,
  isBuiltInExecutor,
  resolveExecutorLaunch,
} from '../executor/profiles.js';
import { runExecutor } from '../executor/run.js';
import type { ExecutorMode, ExecutorResult } from '../executor/types.js';
import { prepareHandoff, updateHandoff, type HandoffBundle } from '../research/proposal/handoff.js';
import { proposalStoreFor } from '../research/proposal/store.js';
import type { HandoffRecord, ProposalSession } from '../research/proposal/types.js';
import type { ResearchSessionStore } from '../research/store.js';
import { resolveStdinShimPath } from '../rubber-duck/launch.js';
import { hasFlag, numberFlag, pathFlag, valueFlag, type ParsedArguments } from './arguments.js';
import type { CliDependencies } from './dependencies.js';
import { findPreset, type CouncilPreset } from './presets.js';
import { resolvePresetModels } from './preset-selection.js';
import { resolveStoreSettings } from './settings-command.js';

export interface HandoffCommandOptions {
  signal?: AbortSignal;
  /** In the shell the person is present, so `--run` asks instead of requiring `--yes`. */
  interactive?: boolean;
  preset?: CouncilPreset;
}

export interface HandoffOutcome {
  session: ProposalSession;
  record: HandoffRecord;
  bundle: HandoffBundle;
  result?: ExecutorResult;
}

export const HANDOFF_CONFIRMATION_REQUIRED =
  'The executor runs with permission to change the repository. Re-run with --yes after reviewing the prompt (--print), or omit --run to prepare the bundle only.';

/** The model the council's preset resolves for a built-in executor; undefined when unknown. */
export async function defaultExecutorModel(
  name: string,
  store: ResearchSessionStore,
  deps: CliDependencies,
  preset?: CouncilPreset
): Promise<string | undefined> {
  if (!isBuiltInExecutor(name)) return undefined;
  const chosen = preset?.modelSlots?.length ? preset : findPreset('frontier');
  try {
    const settings = resolveStoreSettings(store, deps.env);
    const { models } = await resolvePresetModels(chosen, deps, { store, settings });
    return models[name]?.id;
  } catch {
    return undefined;
  }
}

async function repositoryIsDirty(
  repositoryPath: string,
  deps: CliDependencies
): Promise<boolean | undefined> {
  try {
    const result = await deps.runVendorCommand(
      'git',
      ['-C', repositoryPath, 'status', '--porcelain'],
      {
        timeoutMs: 15_000,
        env: deps.env,
        platform: deps.platform,
      }
    );
    if (result.code !== 0) return undefined;
    return result.stdout.trim().length > 0;
  } catch {
    return undefined;
  }
}

/**
 * `hc propose handoff`: write the executor bundle for the proposal and, with `--run`, spawn the
 * executor in the repository with the bundle's prompt, streaming its output to the log.
 */
export async function executeHandoff(
  parsed: ParsedArguments,
  sessionId: string | undefined,
  store: ResearchSessionStore,
  deps: CliDependencies,
  options: HandoffCommandOptions = {}
): Promise<HandoffOutcome> {
  const { io } = deps;
  const proposals = proposalStoreFor(store);
  const session = proposals.load(sessionId);
  const to = valueFlag(parsed, '--to', 'an executor name');
  if (!to) throw new Error('--to is required: claude, codex, agy, grok, or a custom executor name');
  const repositoryPath = resolve(
    deps.cwd,
    pathFlag(parsed, '--repo') ?? session.config.contextRoot
  );
  try {
    if (!lstatSync(repositoryPath).isDirectory()) throw new Error();
  } catch {
    throw new Error(`Repository directory not found: ${repositoryPath}`);
  }
  const model =
    valueFlag(parsed, '--model', 'a model id') ??
    (await defaultExecutorModel(to.toLowerCase(), store, deps, options.preset));
  const mode = valueFlag(parsed, '--mode', 'full-auto or sandboxed') as ExecutorMode | undefined;
  const launch = resolveExecutorLaunch(to, {
    env: deps.env,
    model,
    mode,
    execPath: process.execPath,
    shimPath: resolveStdinShimPath(),
    platform: deps.platform,
  });
  const run = hasFlag(parsed, '--run');
  const bundle = prepareHandoff(proposals, session, {
    repositoryPath,
    executor: {
      profile: launch.profile,
      command: launch.command,
      args: launch.args,
      model: launch.model,
      promptDelivery: launch.promptDelivery,
      mode: launch.mode,
    },
    transport: run ? 'spawned' : 'prompt-only',
  });
  io.err(`Handoff ${bundle.record.id} prepared: ${bundle.directory}`);
  io.err(`Executor: ${describeExecutorLaunch(launch)}`);
  const outPath = pathFlag(parsed, '--out');
  if (outPath) {
    const target = resolve(deps.cwd, outPath);
    copyFileSync(bundle.record.promptPath, target);
    io.err(`Executor prompt copied to: ${target}`);
  }
  if (hasFlag(parsed, '--print')) io.out(bundle.prompt);
  let current = proposals.load(session.id);
  if (!run) return { session: current, record: bundle.record, bundle };

  if (!hasFlag(parsed, '--allow-dirty')) {
    const dirty = await repositoryIsDirty(repositoryPath, deps);
    if (dirty === true) {
      throw new Error(
        `Repository has uncommitted changes: ${repositoryPath}. Commit or stash them, or pass --allow-dirty.`
      );
    }
    if (dirty === undefined)
      io.err('Could not check the repository for uncommitted changes (git status failed).');
  }
  if (!hasFlag(parsed, '--yes')) {
    if (!options.interactive && !io.isInteractive) throw new Error(HANDOFF_CONFIRMATION_REQUIRED);
    const approved = await io.confirm(
      `Run ${launch.profile} in ${repositoryPath} with ${launch.mode} permissions?`
    );
    if (!approved) throw new Error('Handoff cancelled; the bundle was kept.');
  }
  const logPath = join(bundle.directory, 'executor.log');
  current = updateHandoff(
    proposals,
    session.id,
    bundle.record.id,
    { status: 'running', logPath },
    { stage: 'executing', status: 'running' }
  );
  const result = await runExecutor(launch, bundle.prompt, {
    cwd: repositoryPath,
    logPath,
    onLine: (line) => io.err(line),
    signal: options.signal,
    timeoutMs: executorTimeoutMs(deps.env, numberFlag(parsed, '--timeout-ms')),
    env: deps.env,
  });
  const resultPath = result.report
    ? proposals.writeReport(
        session.id,
        join('handoff', bundle.record.id, 'executor-report.md'),
        result.report
      )
    : undefined;
  const status =
    result.status === 'completed'
      ? 'completed'
      : result.status === 'interrupted'
        ? 'interrupted'
        : 'failed';
  current = updateHandoff(
    proposals,
    session.id,
    bundle.record.id,
    {
      status,
      endedAt: new Date().toISOString(),
      exitCode: result.exitCode ?? undefined,
      error: result.error,
      resultPath,
    },
    status === 'completed'
      ? { stage: 'completed', status: 'completed' }
      : { stage: 'handoff-prepared', status }
  );
  io.err(
    status === 'completed'
      ? `Executor finished${resultPath ? `; report: ${resultPath}` : ' without a delimited report'} (${Math.round(result.durationMs / 1000)}s).`
      : `Executor ${result.status}: ${result.error ?? 'unknown error'}. Log: ${logPath}`
  );
  const record = current.handoffs.find((item) => item.id === bundle.record.id)!;
  return { session: current, record, bundle, result };
}
