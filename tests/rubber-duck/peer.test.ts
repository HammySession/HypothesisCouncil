import { jest } from '@jest/globals';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { SdkMcpPeer, createSdkMcpPeer } from '../../src/rubber-duck/peer.js';

function fakeClient() {
  return {
    connect: jest.fn(() => Promise.resolve()),
    listTools: jest.fn(() => Promise.resolve({ tools: [] })),
    callTool: jest.fn(() => Promise.resolve({ content: [{ type: 'text', text: 'ok' }] })),
    close: jest.fn(() => Promise.resolve()),
  };
}

describe('SdkMcpPeer', () => {
  it('connects once, forwards tool operations, and closes once', async () => {
    const client = fakeClient();
    const transport = {} as Transport;
    const peer = new SdkMcpPeer(client as unknown as Client, transport);
    const controller = new AbortController();

    await peer.listTools({ signal: controller.signal });
    await peer.callTool('ask_duck', { prompt: 'hello' }, { timeout: 123 });
    await peer.close();
    await peer.close();

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledWith(transport);
    expect(client.listTools).toHaveBeenCalledWith({}, { signal: controller.signal });
    expect(client.callTool).toHaveBeenCalledWith(
      { name: 'ask_duck', arguments: { prompt: 'hello' } },
      undefined,
      { timeout: 123 }
    );
    expect(client.close).toHaveBeenCalledTimes(1);
    await expect(peer.listTools()).rejects.toThrow('connection is closed');
  });

  it('builds the SDK peer without starting the process eagerly', async () => {
    const client = fakeClient();
    const peer = createSdkMcpPeer(
      '/sessions/RC-2',
      {
        resolveModule: () => '/installed/rubber-duck.js',
        execPath: '/node',
        environment: {},
      },
      { client: client as unknown as Client, transport: {} as Transport }
    );

    expect(client.connect).not.toHaveBeenCalled();
    await peer.listTools();
    expect(client.connect).toHaveBeenCalledTimes(1);
  });
});
