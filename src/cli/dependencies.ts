import { homedir } from 'os';
import { createCouncilRuntime, type CouncilRuntimeFactory } from '../runtime.js';
import { installedRubberDuckVersion } from '../rubber-duck/launch.js';
import { openInBrowser } from './html-report.js';
import { createCommandRunner, type CommandRunner } from './model-discovery.js';
import { findCommand } from './path-lookup.js';
import { createProgressRenderer, type ProgressRenderer } from './progress.js';
import { createTerminalIO, type ShellIO } from './shell/io.js';

/**
 * Everything the command line and the interactive shell take from the process. Commands receive
 * these instead of touching `process.*`, so tests can run them against fakes.
 */
export interface CliDependencies {
  io: ShellIO;
  env: NodeJS.ProcessEnv;
  /** A copy of the environment taken before any preset wrote into it. */
  envSnapshot: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  cwd: string;
  /** Where vendor CLIs keep their configuration and caches. */
  homeDirectory: string;
  runtimeFactory: CouncilRuntimeFactory;
  openInBrowser: (path: string) => void;
  locateCommand: (command: string) => string | undefined;
  /** Spawns read-only vendor listing commands such as `agy models`. */
  runVendorCommand: CommandRunner;
  now: () => number;
  createProgressRenderer: () => ProgressRenderer;
  rubberDuckVersion: () => string | undefined;
}

export function createDefaultDependencies(): CliDependencies {
  const env = process.env;
  return {
    io: createTerminalIO({ stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }),
    env,
    envSnapshot: { ...env },
    platform: process.platform,
    cwd: process.cwd(),
    homeDirectory: homedir(),
    runtimeFactory: (store) => createCouncilRuntime(store),
    openInBrowser: (path) => openInBrowser(path),
    locateCommand: (command) => findCommand(command, env, process.platform),
    runVendorCommand: createCommandRunner(),
    now: Date.now,
    createProgressRenderer: () =>
      createProgressRenderer({
        write: (text) => void process.stderr.write(text),
        live: process.stderr.isTTY === true && env.HYPOTHESIS_COUNCIL_PLAIN_PROGRESS !== 'true',
        columns: process.stderr.columns,
      }),
    rubberDuckVersion: installedRubberDuckVersion,
  };
}
