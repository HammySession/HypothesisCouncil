import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { createSdkMcpPeer, type McpPeer, type McpToolResult } from './peer.js';
import type {
  RubberDuckAnswer,
  RubberDuckClient,
  RubberDuckClientFactory,
  RubberDuckProvider,
} from './types.js';

const DEFAULT_PROVIDER_PROCESS_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_HEADROOM_MS = 60 * 1000;

function positiveMilliseconds(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const milliseconds = Number(value);
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : undefined;
}

export function resolveRubberDuckRequestTimeout(environment: NodeJS.ProcessEnv): number {
  const configuredTimeouts = Object.entries(environment)
    .filter(
      ([name]) =>
        name === 'HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS' ||
        /^CLI_(?:CUSTOM_.+|CLAUDE|CODEX)_PROCESS_TIMEOUT$/.test(name)
    )
    .flatMap(([, value]) => {
      const milliseconds = positiveMilliseconds(value);
      return milliseconds === undefined ? [] : [milliseconds];
    });
  return (
    Math.max(DEFAULT_PROVIDER_PROCESS_TIMEOUT_MS, ...configuredTimeouts) +
    REQUEST_TIMEOUT_HEADROOM_MS
  );
}

function textContent(result: McpToolResult): string {
  return result.content
    .flatMap((item) => {
      if (
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        item.type === 'text' &&
        'text' in item &&
        typeof item.text === 'string'
      ) {
        return [item.text];
      }
      return [];
    })
    .join('\n');
}

function assertToolSuccess(tool: string, result: McpToolResult): string {
  const text = textContent(result);
  if (result.isError) throw new Error(text || `Rubber Duck tool failed: ${tool}`);
  return text;
}

export function parseProviderListing(text: string): RubberDuckProvider[] {
  const providers: RubberDuckProvider[] = [];
  const pattern =
    /^[^\n]*\*\*(.+?)\*\* \(([^)\n]+)\) \[(CLI|HTTP)\]\r?\n\s*📍 Model:\s*([^\r\n]+)/gm;
  for (const match of text.matchAll(pattern)) {
    providers.push({
      nickname: match[1].trim(),
      name: match[2].trim(),
      type: match[3].toLowerCase() as 'cli' | 'http',
      model: match[4].trim(),
    });
  }
  return providers.sort((left, right) => left.name.localeCompare(right.name));
}

export function providerNamesFromTools(
  tools: Array<{ name: string; inputSchema: object }>
): string[] {
  const askDuck = tools.find((tool) => tool.name === 'ask_duck');
  if (!askDuck) return [];
  const schema = askDuck.inputSchema as {
    properties?: { provider?: { enum?: unknown } };
  };
  const values = schema.properties?.provider?.enum;
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string').sort()
    : [];
}

export function parseAskDuckEnvelope(text: string, fallbackModel: string): RubberDuckAnswer {
  // Model names may themselves contain brackets (for example `claude-fable-5[1m]`), so the model
  // segment is matched lazily up to the `]:` that closes the envelope header.
  const header = /^🦆 \[[^|\]\n]+(?:\s+\|\s+([^\n]+?))?\]:[ \t]*/;
  const match = text.match(header);
  let content = match ? text.slice(match[0].length) : text;
  content = content
    .replace(/\n\n📊 Tokens used:[^\n]*(?:\n⏱️ Latency:[^\n]*)?\s*$/, '')
    .replace(/\n⏱️ Latency:[^\n]*\s*$/, '')
    .trim();
  return { content, model: match?.[1]?.trim() || fallbackModel };
}

export class McpRubberDuckClient implements RubberDuckClient {
  constructor(
    private readonly peer: McpPeer,
    private readonly requestTimeoutMs = resolveRubberDuckRequestTimeout(process.env)
  ) {}

  async listProviders(signal?: AbortSignal): Promise<RubberDuckProvider[]> {
    let result: McpToolResult;
    try {
      result = await this.request(
        () => this.peer.callTool('list_ducks', { check_health: false }, this.options(signal)),
        signal
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Unable to start the installed Rubber Duck MCP server. Configure at least one provider through environment variables or ~/.mcp-rubber-duck/config.json. ${message}`
      );
    }
    const providers = parseProviderListing(assertToolSuccess('list_ducks', result));
    if (providers.length > 0) return providers;

    const listed = await this.request(() => this.peer.listTools(this.options(signal)), signal);
    return providerNamesFromTools(listed.tools).map((name) => ({
      name,
      nickname: name,
      model: 'provider-default',
      type: 'unknown',
    }));
  }

  async ask(provider: string, prompt: string, signal?: AbortSignal): Promise<RubberDuckAnswer> {
    const result = await this.request(
      () => this.peer.callTool('ask_duck', { provider, prompt }, this.options(signal)),
      signal
    );
    return parseAskDuckEnvelope(assertToolSuccess('ask_duck', result), 'provider-default');
  }

  close(): Promise<void> {
    return this.peer.close();
  }

  private options(signal?: AbortSignal): RequestOptions {
    return { signal, timeout: this.requestTimeoutMs };
  }

  private async request<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      await this.close();
      throw new Error('Rubber Duck request cancelled');
    }
    const abort = () => void this.close().catch(() => undefined);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return await operation();
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
}

export const createRubberDuckClient: RubberDuckClientFactory = (workingDirectory) =>
  new McpRubberDuckClient(createSdkMcpPeer(workingDirectory));
