import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  type StdioServerParameters,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { resolveRubberDuckLaunch, type RubberDuckLaunchOptions } from './launch.js';
import { VERSION } from '../version.js';

export interface McpToolDescription {
  name: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, object>;
  };
}

export interface McpToolResult {
  content: unknown[];
  isError?: boolean;
}

export interface McpPeer {
  listTools(options?: RequestOptions): Promise<{ tools: McpToolDescription[] }>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<McpToolResult>;
  close(): Promise<void>;
}

type SdkClient = Pick<Client, 'connect' | 'listTools' | 'callTool' | 'close'>;

export interface SdkMcpPeerDependencies {
  client?: SdkClient;
  transport?: Transport;
}

export class SdkMcpPeer implements McpPeer {
  private connection?: Promise<void>;
  private closed = false;

  constructor(
    private readonly client: SdkClient,
    private readonly transport: Transport
  ) {}

  async listTools(options?: RequestOptions): Promise<{ tools: McpToolDescription[] }> {
    await this.ensureConnected();
    const result = await this.client.listTools({}, options);
    return { tools: result.tools };
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<McpToolResult> {
    await this.ensureConnected();
    const result = await this.client.callTool({ name, arguments: args }, undefined, options);
    return {
      content: Array.isArray(result.content) ? result.content : [],
      isError: typeof result.isError === 'boolean' ? result.isError : undefined,
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (!this.connection) return;
    try {
      await this.connection;
    } finally {
      await this.client.close();
    }
  }

  private ensureConnected(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Rubber Duck MCP connection is closed'));
    this.connection ||= this.client.connect(this.transport);
    return this.connection;
  }
}

export function createSdkMcpPeer(
  workingDirectory: string,
  launchOptions: RubberDuckLaunchOptions = {},
  dependencies: SdkMcpPeerDependencies = {}
): SdkMcpPeer {
  const launch = resolveRubberDuckLaunch(workingDirectory, launchOptions);
  const client =
    dependencies.client || new Client({ name: 'hypothesis-council', version: VERSION });
  const transport =
    dependencies.transport || new StdioClientTransport(launch satisfies StdioServerParameters);
  return new SdkMcpPeer(client, transport);
}
