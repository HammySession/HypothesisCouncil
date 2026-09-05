import type { ExecutorLaunch, ExecutorMode, PromptDelivery } from './types.js';

export const EXECUTOR_MODE_VARIABLE = 'HYPOTHESIS_COUNCIL_EXECUTOR_MODE';
export const EXECUTOR_TIMEOUT_VARIABLE = 'HYPOTHESIS_COUNCIL_EXECUTOR_TIMEOUT_MS';
export const DEFAULT_EXECUTOR_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const DEFAULT_EXECUTOR_MAX_TURNS = 400;

export const BUILT_IN_EXECUTORS = ['claude', 'codex', 'agy', 'grok'] as const;
export type BuiltInExecutor = (typeof BUILT_IN_EXECUTORS)[number];

const MODES: readonly ExecutorMode[] = ['full-auto', 'sandboxed'];
const DELIVERIES: readonly PromptDelivery[] = ['stdin', 'argument', 'prompt-file'];

export interface ExecutorProfileOptions {
  env: NodeJS.ProcessEnv;
  model?: string;
  /** Overrides the environment's mode. */
  mode?: ExecutorMode;
  /** Node executable and the built stdin shim, for CLIs that cannot read a prompt from stdin. */
  execPath?: string;
  shimPath?: string;
  platform?: NodeJS.Platform;
}

export function isBuiltInExecutor(name: string): name is BuiltInExecutor {
  return (BUILT_IN_EXECUTORS as readonly string[]).includes(name);
}

/** `full-auto` unless the environment says `sandboxed`. */
export function executorMode(env: NodeJS.ProcessEnv, override?: ExecutorMode): ExecutorMode {
  const value = override ?? env[EXECUTOR_MODE_VARIABLE] ?? 'full-auto';
  if (!MODES.includes(value as ExecutorMode)) {
    throw new Error(`${EXECUTOR_MODE_VARIABLE} must be full-auto or sandboxed, got "${value}"`);
  }
  return value as ExecutorMode;
}

export function executorTimeoutMs(env: NodeJS.ProcessEnv, override?: number): number {
  const raw =
    override ??
    (env[EXECUTOR_TIMEOUT_VARIABLE] ? Number(env[EXECUTOR_TIMEOUT_VARIABLE]) : undefined);
  if (raw === undefined) return DEFAULT_EXECUTOR_TIMEOUT_MS;
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error(`${EXECUTOR_TIMEOUT_VARIABLE} must be a positive number of milliseconds`);
  }
  return raw;
}

/** Environment variable names for a custom executor profile, for example `NIGHTLY`. */
export function customExecutorVariables(name: string): {
  command: string;
  args: string;
  promptDelivery: string;
  modelFlag: string;
} {
  const key = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const prefix = `HYPOTHESIS_COUNCIL_EXECUTOR_${key}`;
  return {
    command: `${prefix}_COMMAND`,
    args: `${prefix}_ARGS`,
    promptDelivery: `${prefix}_PROMPT_DELIVERY`,
    modelFlag: `${prefix}_MODEL_FLAG`,
  };
}

function splitArgs(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function needsShell(command: string, platform: NodeJS.Platform, execPath: string): boolean {
  if (platform !== 'win32') return false;
  if (command === execPath) return false;
  return !/\.(exe|com|js|mjs|cjs)$/i.test(command) && !/[\\/]/.test(command);
}

function customLaunch(
  name: string,
  options: ExecutorProfileOptions,
  mode: ExecutorMode
): ExecutorLaunch | undefined {
  const variables = customExecutorVariables(name);
  const command = options.env[variables.command];
  if (!command) return undefined;
  const delivery = options.env[variables.promptDelivery] ?? 'stdin';
  if (!DELIVERIES.includes(delivery as PromptDelivery)) {
    throw new Error(
      `${variables.promptDelivery} must be stdin, argument, or prompt-file, got "${delivery}"`
    );
  }
  const args = splitArgs(options.env[variables.args]);
  const modelFlag = options.env[variables.modelFlag];
  if (options.model && modelFlag) args.push(modelFlag, options.model);
  return {
    profile: name,
    command,
    args,
    promptDelivery: delivery as PromptDelivery,
    model: options.model,
    mode,
    shell: needsShell(
      command,
      options.platform ?? process.platform,
      options.execPath ?? process.execPath
    ),
  };
}

function shimmed(
  mode: 'prompt-file' | 'agy-stream-json',
  vendorCommand: string[],
  options: ExecutorProfileOptions
): { command: string; args: string[] } {
  if (!options.shimPath) {
    throw new Error(`The ${vendorCommand[0]} executor needs the stdin shim path`);
  }
  return {
    command: options.execPath ?? process.execPath,
    args: [options.shimPath, mode, '--', ...vendorCommand],
  };
}

/**
 * The command line for a named executor. Built-in profiles run the vendor CLI in full-auto mode
 * (no approval prompts, file edits allowed) unless the mode is `sandboxed`; a custom profile is
 * read from `HYPOTHESIS_COUNCIL_EXECUTOR_<NAME>_*` and overrides a built-in of the same name.
 */
export function resolveExecutorLaunch(
  name: string,
  options: ExecutorProfileOptions
): ExecutorLaunch {
  const profile = name.trim().toLowerCase();
  if (!profile) throw new Error('An executor name is required');
  const mode = executorMode(options.env, options.mode);
  const custom = customLaunch(profile, options, mode);
  if (custom) return custom;
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  const model = options.model;
  switch (profile) {
    case 'claude': {
      const args = [
        '-p',
        '--output-format',
        'text',
        ...(mode === 'full-auto'
          ? ['--dangerously-skip-permissions']
          : ['--permission-mode', 'acceptEdits']),
        '--max-turns',
        String(DEFAULT_EXECUTOR_MAX_TURNS),
      ];
      if (model) args.push('--model', model);
      return {
        profile,
        command: 'claude',
        args,
        promptDelivery: 'stdin',
        model,
        mode,
        shell: needsShell('claude', platform, execPath),
      };
    }
    case 'codex': {
      const args = [
        'exec',
        '--skip-git-repo-check',
        ...(mode === 'full-auto'
          ? ['--dangerously-bypass-approvals-and-sandbox']
          : ['--full-auto']),
      ];
      if (model) args.push('--model', model);
      args.push('-');
      return {
        profile,
        command: 'codex',
        args,
        promptDelivery: 'stdin',
        model,
        mode,
        shell: needsShell('codex', platform, execPath),
      };
    }
    case 'agy': {
      const vendor = ['agy', ...(model ? ['--model', model] : []), '--effort', 'high'];
      vendor.push(mode === 'full-auto' ? '--yolo' : '--sandbox');
      return {
        profile,
        ...shimmed('agy-stream-json', vendor, options),
        promptDelivery: 'stdin',
        model,
        mode,
      };
    }
    case 'grok': {
      const vendor = ['grok', ...(model ? ['-m', model] : []), '--reasoning-effort', 'high'];
      return {
        profile,
        ...shimmed('prompt-file', vendor, options),
        promptDelivery: 'stdin',
        model,
        mode,
      };
    }
    default:
      throw new Error(
        `Unknown executor: ${name}. Use ${BUILT_IN_EXECUTORS.join(', ')}, or define ${customExecutorVariables(profile).command}.`
      );
  }
}

export function describeExecutorLaunch(launch: ExecutorLaunch): string {
  const model = launch.model ? ` · model ${launch.model}` : '';
  return `${launch.profile} (${launch.mode}${model}): ${[launch.command, ...launch.args].join(' ')}`;
}
