/**
 * Command-line argument builders for the vendor CLIs Rubber Duck launches. The council profiles
 * keep every CLI off the web and away from tools; the scout profiles open exactly the web tools.
 * Rubber Duck receives arguments as a comma-separated `CLI_ARGS` string, so no argument here may
 * contain a comma.
 */

export const CODEX_REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

export interface ClaudeArgsOptions {
  model?: string;
  /** Agentic turn budget; the council needs none beyond the answer, scouts need room to search. */
  maxTurns?: number;
  /**
   * Built-in tools to expose (`--tools`). Empty means no tools. Space-separated tool names are
   * passed as separate arguments because `--tools` is variadic.
   */
  tools?: string[];
  /** `--restricted` removes command-running tools and confines file tools; scouts use it. */
  restricted?: boolean;
}

export function claudeArgs(options: ClaudeArgsOptions = {}): string[] {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--max-turns',
    String(options.maxTurns ?? 3),
    '--no-session-persistence',
    '--permission-mode',
    'dontAsk',
  ];
  if (options.model) args.push('--model', options.model);
  if (options.restricted) args.push('--restricted');
  // Ignore user MCP servers so the prompt is answered directly instead of spending the turn
  // budget on tool calls; `--tools` then names exactly the built-in tools that stay available.
  args.push('--strict-mcp-config', '--tools', ...(options.tools?.length ? options.tools : ['']));
  if (options.tools?.length) args.push('--allowedTools', ...options.tools);
  return args;
}

export interface CodexArgsOptions {
  model?: string;
  reasoningEffort?: string;
  /**
   * Extra `-c key=value` overrides, for example `web_search="live"` for a scout. Values must not
   * contain commas.
   */
  configOverrides?: string[];
}

export function assertCodexReasoningEffort(value: string): CodexReasoningEffort {
  if (!(CODEX_REASONING_EFFORTS as readonly string[]).includes(value)) {
    throw new Error(
      'HYPOTHESIS_COUNCIL_CODEX_REASONING_EFFORT must be none, low, medium, high, xhigh, or max'
    );
  }
  return value as CodexReasoningEffort;
}

export function codexArgs(options: CodexArgsOptions = {}): string[] {
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--ephemeral',
    '--color',
    'never',
  ];
  if (options.model) args.push('--model', options.model);
  if (options.reasoningEffort) {
    args.push(
      '-c',
      `model_reasoning_effort="${assertCodexReasoningEffort(options.reasoningEffort)}"`
    );
  }
  for (const override of options.configOverrides ?? []) args.push('-c', override);
  args.push('-');
  return args;
}

export interface GrokArgsOptions {
  model?: string;
  reasoningEffort?: string;
  /** Grok searches the web by default; the council switches it off, scouts leave it on. */
  webSearch: boolean;
}

export function grokArgs(options: GrokArgsOptions): string[] {
  const args = ['grok'];
  if (options.model) args.push('-m', options.model);
  if (options.reasoningEffort) args.push('--reasoning-effort', options.reasoningEffort);
  if (!options.webSearch) args.push('--disable-web-search');
  return args;
}

export interface AgyArgsOptions {
  model?: string;
  effort?: string;
}

export function agyArgs(options: AgyArgsOptions = {}): string[] {
  const args = ['agy'];
  if (options.model) args.push('--model', options.model);
  if (options.effort) args.push('--effort', options.effort);
  args.push('--sandbox');
  return args;
}

/** Whether a vendor argument list leaves web tools reachable, as far as the flags reveal. */
export function webAccessFromArgs(command: string, args: string[]): 'on' | 'off' | 'unknown' {
  const base = command.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
  if (base === 'grok') return args.includes('--disable-web-search') ? 'off' : 'on';
  if (base === 'claude') {
    const index = args.indexOf('--tools');
    if (index === -1) return 'unknown';
    const tools: string[] = [];
    for (const arg of args.slice(index + 1)) {
      if (arg.startsWith('-')) break;
      tools.push(...arg.split(/[\s,]+/).filter(Boolean));
    }
    if (tools.length === 0) return 'off';
    if (tools.includes('default')) return 'on';
    return tools.some((tool) => /^web(search|fetch)$/i.test(tool)) ? 'on' : 'off';
  }
  if (base === 'codex') {
    const enabled = args.some(
      (arg, index) =>
        args[index - 1] === '-c' && /^web_search\s*=\s*"?(live|cached|true)"?$/i.test(arg)
    );
    return enabled ? 'on' : 'off';
  }
  return 'unknown';
}
