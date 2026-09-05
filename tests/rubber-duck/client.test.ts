import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  McpRubberDuckClient,
  resolveRubberDuckRequestTimeout,
} from '../../src/rubber-duck/client.js';
import type { McpPeer, McpToolResult } from '../../src/rubber-duck/peer.js';

class FakePeer implements McpPeer {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  closed = 0;
  toolResult: McpToolResult = { content: [] };
  tools: Array<{
    name: string;
    inputSchema: { type: 'object'; properties?: Record<string, object> };
  }> = [];
  pending?: Promise<McpToolResult>;
  failure?: Error;
  lastOptions?: RequestOptions;

  listTools() {
    return Promise.resolve({ tools: this.tools });
  }

  callTool(name: string, args: Record<string, unknown>, options?: RequestOptions) {
    this.calls.push({ name, args });
    this.lastOptions = options;
    if (this.failure) return Promise.reject(this.failure);
    return this.pending || Promise.resolve(this.toolResult);
  }

  close() {
    this.closed++;
    return Promise.resolve();
  }
}

describe('McpRubberDuckClient', () => {
  it('keeps MCP requests alive beyond the longest configured provider process', async () => {
    const peer = new FakePeer();
    const timeout = resolveRubberDuckRequestTimeout({
      CLI_CUSTOM_AGY_PROCESS_TIMEOUT: '600000',
      HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS: '900000',
    });

    await new McpRubberDuckClient(peer, timeout).ask('duck', 'prompt');

    expect(timeout).toBe(960000);
    expect(peer.lastOptions?.timeout).toBe(960000);
  });

  it('discovers provider metadata from the public list_ducks response', async () => {
    const peer = new FakePeer();
    peer.toolResult = {
      content: [
        {
          type: 'text',
          text: [
            'Found 2 duck(s) in the pond:',
            '',
            '❓ **Claude Duck** (claude-cli) [CLI]',
            '   📍 Model: claude-default',
            '❓ **OpenAI Duck** (openai) [HTTP]',
            '   📍 Model: gpt-default',
          ].join('\n'),
        },
      ],
    };

    const client = new McpRubberDuckClient(peer);
    await expect(client.listProviders()).resolves.toEqual([
      { name: 'claude-cli', nickname: 'Claude Duck', model: 'claude-default', type: 'cli' },
      { name: 'openai', nickname: 'OpenAI Duck', model: 'gpt-default', type: 'http' },
    ]);
  });

  it('falls back to the ask_duck provider enum when display formatting changes', async () => {
    const peer = new FakePeer();
    peer.toolResult = { content: [{ type: 'text', text: 'new unrecognized format' }] };
    peer.tools = [
      {
        name: 'ask_duck',
        inputSchema: {
          type: 'object',
          properties: { provider: { type: 'string', enum: ['zeta', 'alpha'] } },
        },
      },
    ];

    await expect(new McpRubberDuckClient(peer).listProviders()).resolves.toEqual([
      { name: 'alpha', nickname: 'alpha', model: 'provider-default', type: 'unknown' },
      { name: 'zeta', nickname: 'zeta', model: 'provider-default', type: 'unknown' },
    ]);
  });

  it('returns model output without the Rubber Duck presentation envelope', async () => {
    const peer = new FakePeer();
    peer.toolResult = {
      content: [
        {
          type: 'text',
          text: '🦆 [Claude Duck | claude-4]: {"answer":true}\n\n📊 Tokens used: 9 (5 prompt, 4 completion)\n⏱️ Latency: 10ms',
        },
      ],
    };

    const client = new McpRubberDuckClient(peer);
    await expect(client.ask('claude-cli', 'Return JSON')).resolves.toEqual({
      content: '{"answer":true}',
      model: 'claude-4',
    });
    expect(peer.calls[0]).toEqual({
      name: 'ask_duck',
      args: { provider: 'claude-cli', prompt: 'Return JSON' },
    });
  });

  it('strips the envelope when the model name itself contains brackets', async () => {
    const peer = new FakePeer();
    peer.toolResult = {
      content: [
        { type: 'text', text: '🦆 [CLAUDE Agent | claude-fable-5[1m]]: READY\n\n⏱️ Latency: 10ms' },
      ],
    };

    await expect(new McpRubberDuckClient(peer).ask('cli-claude', 'Reply READY')).resolves.toEqual({
      content: 'READY',
      model: 'claude-fable-5[1m]',
    });
  });

  it('turns MCP tool errors into exceptions', async () => {
    const peer = new FakePeer();
    peer.toolResult = { isError: true, content: [{ type: 'text', text: 'provider failed' }] };
    await expect(new McpRubberDuckClient(peer).ask('duck', 'prompt')).rejects.toThrow(
      'provider failed'
    );
  });

  it('explains the provider configuration requirement when Rubber Duck cannot start', async () => {
    const peer = new FakePeer();
    peer.failure = new Error('MCP error -32000: Connection closed');

    await expect(new McpRubberDuckClient(peer).listProviders()).rejects.toThrow(
      'Configure at least one provider'
    );
  });

  it('preserves cancellation errors instead of reporting a provider configuration problem', async () => {
    const peer = new FakePeer();
    const controller = new AbortController();
    controller.abort();

    await expect(new McpRubberDuckClient(peer).listProviders(controller.signal)).rejects.toThrow(
      'request cancelled'
    );
  });

  it('closes the subprocess connection when a request is aborted', async () => {
    const peer = new FakePeer();
    peer.pending = new Promise(() => undefined);
    const controller = new AbortController();
    const pending = new McpRubberDuckClient(peer).ask('duck', 'prompt', controller.signal);

    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));

    expect(peer.closed).toBe(1);
    void pending.catch(() => undefined);
  });
});
