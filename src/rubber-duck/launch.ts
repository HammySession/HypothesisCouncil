import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { claudeArgs, codexArgs } from './vendor-args.js';

export interface RubberDuckLaunch {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stderr: 'inherit';
}

export interface RubberDuckLaunchOptions {
  resolveModule?: (specifier: string) => string;
  execPath?: string;
  environment?: NodeJS.ProcessEnv;
  codexModel?: string;
}

const require = createRequire(import.meta.url);
const DEFAULT_STDIN_PROCESS_TIMEOUT_MS = 5 * 60 * 1000;

function processTimeout(environment: Record<string, string>, name: 'CLAUDE' | 'CODEX'): string {
  return (
    environment[`CLI_${name}_PROCESS_TIMEOUT`] ||
    environment.HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS ||
    String(DEFAULT_STDIN_PROCESS_TIMEOUT_MS)
  );
}

export function definedEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

/** Absolute path of the built stdin shim that sits beside this module. */
export function resolveStdinShimPath(): string {
  return fileURLToPath(new URL('./stdin-shim.js', import.meta.url));
}

/** Version of the Rubber Duck package that is actually installed, if it can be determined. */
export function installedRubberDuckVersion(
  resolveModule: (specifier: string) => string = (specifier) => require.resolve(specifier)
): string | undefined {
  try {
    let directory = dirname(resolveModule('mcp-rubber-duck'));
    for (let depth = 0; depth < 4; depth++) {
      const manifest = join(directory, 'package.json');
      if (existsSync(manifest)) {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as {
          name?: string;
          version?: string;
        };
        if (parsed.name === 'mcp-rubber-duck' && parsed.version) return parsed.version;
      }
      directory = dirname(directory);
    }
  } catch {
    // Fall through: the package is missing or its manifest is unreadable.
  }
  return undefined;
}

function configuredCodexModel(environment: NodeJS.ProcessEnv): string | undefined {
  if (environment.CLI_CODEX_DEFAULT_MODEL) return environment.CLI_CODEX_DEFAULT_MODEL;
  const configHome = environment.CODEX_HOME || join(homedir(), '.codex');
  try {
    const config = readFileSync(join(configHome, 'config.toml'), 'utf8');
    return config.match(/^\s*model\s*=\s*["']([^"']+)["']/m)?.[1];
  } catch {
    return undefined;
  }
}

function moveDefaultPresetToStdin(
  environment: Record<string, string>,
  name: 'CLAUDE' | 'CODEX',
  values: Record<string, string>
): void {
  if (environment[`CLI_${name}_ENABLED`] !== 'true') return;
  if (
    environment[`CLI_${name}_CLI_ARGS`] ||
    environment[`CLI_${name}_SYSTEM_PROMPT`] ||
    environment[`CLI_CUSTOM_${name}_COMMAND`]
  )
    return;
  delete environment[`CLI_${name}_ENABLED`];
  for (const [suffix, value] of Object.entries(values)) {
    environment[`CLI_CUSTOM_${name}_${suffix}`] = value;
  }
  const nickname = environment[`CLI_${name}_NICKNAME`];
  const model = environment[`CLI_${name}_DEFAULT_MODEL`];
  if (nickname) environment[`CLI_CUSTOM_${name}_NICKNAME`] = nickname;
  if (model) environment[`CLI_CUSTOM_${name}_DEFAULT_MODEL`] = model;
}

export function rubberDuckEnvironment(
  source: NodeJS.ProcessEnv,
  codexModel?: string
): Record<string, string> {
  const environment = definedEnvironment(source);
  // Rubber Duck logs every provider start-up at info level on the inherited stderr; keep the
  // terminal quiet unless the person asked for more.
  if (!environment.LOG_LEVEL) environment.LOG_LEVEL = 'warn';
  if (environment.HYPOTHESIS_COUNCIL_DISABLE_STDIN_COMPATIBILITY === 'true') {
    return environment;
  }
  // Council members answer from the sealed packet: no built-in tools, no user MCP servers.
  moveDefaultPresetToStdin(environment, 'CLAUDE', {
    COMMAND: 'claude',
    PROMPT_DELIVERY: 'stdin',
    OUTPUT_FORMAT: 'json',
    CLI_ARGS: claudeArgs({ model: environment.CLI_CLAUDE_DEFAULT_MODEL }).join(','),
    PROCESS_TIMEOUT: processTimeout(environment, 'CLAUDE'),
  });
  if (
    environment.CLI_CODEX_ENABLED === 'true' &&
    !environment.CLI_CODEX_CLI_ARGS &&
    !environment.CLI_CODEX_SYSTEM_PROMPT
  ) {
    const resolvedCodexModel = codexModel || configuredCodexModel(source);
    if (resolvedCodexModel && !environment.CLI_CODEX_DEFAULT_MODEL) {
      environment.CLI_CODEX_DEFAULT_MODEL = resolvedCodexModel;
    }
  }
  moveDefaultPresetToStdin(environment, 'CODEX', {
    COMMAND: 'codex',
    PROMPT_DELIVERY: 'stdin',
    OUTPUT_FORMAT: 'text',
    CLI_ARGS: codexArgs({
      model: environment.CLI_CODEX_DEFAULT_MODEL,
      reasoningEffort: environment.HYPOTHESIS_COUNCIL_CODEX_REASONING_EFFORT || undefined,
    }).join(','),
    PROCESS_TIMEOUT: processTimeout(environment, 'CODEX'),
  });
  return environment;
}

export function resolveRubberDuckLaunch(
  workingDirectory: string,
  options: RubberDuckLaunchOptions = {}
): RubberDuckLaunch {
  const resolveModule =
    options.resolveModule || ((specifier: string) => require.resolve(specifier));
  const entrypoint = resolveModule('mcp-rubber-duck');
  return {
    command: options.execPath || process.execPath,
    args: [entrypoint],
    cwd: workingDirectory,
    env: rubberDuckEnvironment(options.environment || process.env, options.codexModel),
    stderr: 'inherit',
  };
}
