/**
 * The executor is the one agent that carries a research proposal out. Unlike council providers,
 * it runs with the repository as its working directory and with permission to change files, so
 * this module is the only place in the project that spawns a vendor CLI directly.
 */

export type ExecutorMode = 'full-auto' | 'sandboxed';

export type PromptDelivery = 'stdin' | 'argument' | 'prompt-file';

export interface ExecutorLaunch {
  /** Profile name: `claude`, `codex`, `agy`, `grok`, or a custom name from the environment. */
  profile: string;
  command: string;
  args: string[];
  promptDelivery: PromptDelivery;
  model?: string;
  mode: ExecutorMode;
  /** Whether a shell is needed to start the command (Windows `.cmd` shims). */
  shell?: boolean;
}

export type ExecutorStatus = 'completed' | 'failed' | 'interrupted' | 'timed-out';

export interface ExecutorRunOptions {
  cwd: string;
  /** Every stdout and stderr line is appended here as it arrives. */
  logPath?: string;
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface ExecutorResult {
  status: ExecutorStatus;
  exitCode: number | null;
  /** The report between the delimiters, when the executor printed one. */
  report?: string;
  output: string;
  durationMs: number;
  error?: string;
}
