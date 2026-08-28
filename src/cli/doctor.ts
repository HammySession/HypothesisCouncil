import {
  argumentTransportLimitBytes,
  calculateContextBudget,
  usesArgumentTransport,
} from '../research/context-budget.js';
import type { ProviderDescriptor, ResearchProviderGateway } from '../research/types.js';
import { STDIN_SHIM_MODES, type StdinShimMode } from '../rubber-duck/stdin-shim-core.js';
import { formatBytes } from './format.js';
import { findCommand } from './path-lookup.js';

export type ProviderTransport = 'stdin' | 'argument' | 'http' | 'unknown';

export interface DoctorProbeResult {
  ok: boolean;
  latencyMs: number;
  reply?: string;
  error?: string;
}

export interface DoctorProviderReport {
  name: string;
  nickname: string;
  model: string;
  type: ProviderDescriptor['type'];
  /** Vendor CLI the provider runs, when it can be derived from the environment. */
  command?: string;
  commandPath?: string;
  viaStdinShim: boolean;
  transport: ProviderTransport;
  contextWindowTokens: number;
  contextSource: 'model' | 'provider-default' | 'configured-override';
  maxContextBytes: number;
  transportLimited: boolean;
  probe?: DoctorProbeResult;
}

export interface DoctorReport {
  platform: NodeJS.Platform;
  nodeVersion: string;
  rubberDuckVersion?: string;
  sessionHome: string;
  argumentTransportLimitBytes: number;
  providers: DoctorProviderReport[];
  problems: string[];
  hints: string[];
}

export interface DoctorOptions {
  gateway: ResearchProviderGateway;
  workingDirectory: string;
  sessionHome: string;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  nodeVersion?: string;
  rubberDuckVersion?: string;
  probe?: boolean;
  signal?: AbortSignal;
  locateCommand?: (command: string) => string | undefined;
  now?: () => number;
}

const PROBE_PROMPT =
  'You are answering a non-interactive request with no tools. Reply with exactly the word READY and nothing else.';

function providerKey(name: string): string {
  return name
    .replace(/^cli-/, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .toUpperCase();
}

/** Derive the vendor command a CLI provider runs from Rubber Duck's environment configuration. */
export function providerCommand(
  provider: ProviderDescriptor,
  environment: NodeJS.ProcessEnv
): { command: string; viaStdinShim: boolean } | undefined {
  if (provider.type !== 'cli') return undefined;
  const key = providerKey(provider.name);
  const custom = environment[`CLI_CUSTOM_${key}_COMMAND`];
  if (custom) {
    const args = (environment[`CLI_CUSTOM_${key}_CLI_ARGS`] || '').split(',');
    const separator = args.indexOf('--');
    const mode = args[separator - 1] as StdinShimMode | undefined;
    if (separator > 0 && mode && STDIN_SHIM_MODES.includes(mode) && args[separator + 1]) {
      return { command: args[separator + 1], viaStdinShim: true };
    }
    return { command: custom, viaStdinShim: false };
  }
  if (environment[`CLI_${key}_ENABLED`] === 'true') {
    return { command: key.toLowerCase(), viaStdinShim: false };
  }
  return undefined;
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const environment = options.environment || process.env;
  const platform = options.platform || process.platform;
  const locate =
    options.locateCommand || ((command: string) => findCommand(command, environment, platform));
  const now = options.now || Date.now;
  const report: DoctorReport = {
    platform,
    nodeVersion: options.nodeVersion || process.version,
    rubberDuckVersion: options.rubberDuckVersion,
    sessionHome: options.sessionHome,
    argumentTransportLimitBytes: argumentTransportLimitBytes(platform),
    providers: [],
    problems: [],
    hints: [],
  };

  let descriptors: ProviderDescriptor[];
  try {
    descriptors = await options.gateway.listProviders(options.workingDirectory, options.signal);
  } catch (error) {
    report.problems.push(error instanceof Error ? error.message : String(error));
    report.hints.push(
      'Enable at least one provider (for example `CLI_CLAUDE_ENABLED=true`) or run with `--preset quick`.'
    );
    return report;
  }
  if (descriptors.length === 0) {
    report.problems.push('Rubber Duck started but no providers are configured.');
    report.hints.push('Run `hc presets` to see ready-made councils, then `hc run --preset NAME`.');
    return report;
  }

  for (const descriptor of descriptors) {
    const limit = calculateContextBudget(
      descriptors,
      [descriptor.name],
      undefined,
      environment,
      platform
    ).providerLimits[0];
    const resolved = providerCommand(descriptor, environment);
    const commandPath = resolved ? locate(resolved.command) : undefined;
    const transport: ProviderTransport =
      descriptor.type === 'http'
        ? 'http'
        : descriptor.type === 'cli'
          ? usesArgumentTransport(descriptor, environment)
            ? 'argument'
            : 'stdin'
          : 'unknown';
    const entry: DoctorProviderReport = {
      name: descriptor.name,
      nickname: descriptor.nickname,
      model: descriptor.model,
      type: descriptor.type,
      command: resolved?.command,
      commandPath,
      viaStdinShim: resolved?.viaStdinShim === true,
      transport,
      contextWindowTokens: limit.contextWindowTokens,
      contextSource: limit.source,
      maxContextBytes: limit.maxContextBytes,
      transportLimited: limit.transportLimited,
    };
    if (resolved && !commandPath) {
      report.problems.push(`${descriptor.name}: command "${resolved.command}" is not on PATH.`);
    }
    if (limit.transportLimited) {
      report.hints.push(
        `${descriptor.name} receives the prompt as a command-line argument, so shared context is capped at ${formatBytes(limit.maxContextBytes)} on ${platform}. A preset delivers prompts through stdin; or set CLI_CUSTOM_${providerKey(descriptor.name)}_PROMPT_DELIVERY=stdin if the CLI reads stdin.`
      );
    }
    if (limit.source === 'provider-default') {
      report.hints.push(
        `${descriptor.name}: the model window is a conservative default; set HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_${descriptor.name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()} to its real context size.`
      );
    }
    if (options.probe && (!resolved || commandPath)) {
      const startedAt = now();
      try {
        const completion = await options.gateway.complete(descriptor.name, PROBE_PROMPT, {
          workingDirectory: options.workingDirectory,
          signal: options.signal,
        });
        const reply = completion.content.trim();
        entry.probe = {
          ok: reply.length > 0,
          latencyMs: now() - startedAt,
          reply: reply.slice(0, 60),
        };
        if (!entry.probe.ok)
          report.problems.push(`${descriptor.name}: probe returned an empty reply.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        entry.probe = { ok: false, latencyMs: now() - startedAt, error: message };
        report.problems.push(`${descriptor.name}: probe failed: ${message}`);
      }
    }
    report.providers.push(entry);
  }
  if (!options.probe) {
    report.hints.push('Run `hc doctor --probe` to send a one-line prompt to every provider.');
  }
  return report;
}

function table(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length))
  );
  const render = (row: string[]) =>
    row
      .map((cell, index) => cell.padEnd(widths[index]))
      .join('  ')
      .trimEnd();
  return [render(headers), ...rows.map(render)];
}

export function doctorText(report: DoctorReport): string {
  const lines = [
    'Hypothesis Council doctor',
    `Platform: ${report.platform} · Node ${report.nodeVersion} · mcp-rubber-duck ${report.rubberDuckVersion || 'unknown'}`,
    `Sessions: ${report.sessionHome}`,
    `Argument-transport cap on this platform: ${formatBytes(report.argumentTransportLimitBytes)}`,
    '',
  ];
  if (report.providers.length > 0) {
    const rows = report.providers.map((provider) => [
      provider.name,
      provider.model,
      `${provider.contextWindowTokens.toLocaleString()}${provider.contextSource === 'provider-default' ? ' (assumed)' : ''}`,
      provider.transportLimited
        ? `argument (${formatBytes(provider.maxContextBytes)} cap)`
        : provider.transport + (provider.viaStdinShim ? ' via shim' : ''),
      provider.command
        ? `${provider.command} ${provider.commandPath ? '✓' : '✗ not found'}`
        : provider.type === 'http'
          ? 'n/a'
          : '?',
      provider.probe
        ? provider.probe.ok
          ? `ok ${(provider.probe.latencyMs / 1000).toFixed(1)}s "${provider.probe.reply}"`
          : `FAILED ${(provider.probe.latencyMs / 1000).toFixed(1)}s`
        : '—',
    ]);
    lines.push(...table(['PROVIDER', 'MODEL', 'WINDOW', 'TRANSPORT', 'COMMAND', 'PROBE'], rows));
    lines.push('');
  }
  if (report.problems.length > 0) {
    lines.push('Problems:');
    for (const problem of report.problems) lines.push(`  ✗ ${problem}`);
    lines.push('');
  } else if (report.providers.length > 0) {
    lines.push('No problems found.');
    lines.push('');
  }
  if (report.hints.length > 0) {
    lines.push('Hints:');
    for (const hint of report.hints) lines.push(`  - ${hint}`);
  }
  return lines.join('\n').trimEnd();
}
