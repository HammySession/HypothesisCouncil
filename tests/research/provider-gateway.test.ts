import { RubberDuckResearchGateway } from '../../src/research/provider-gateway.js';
import type {
  RubberDuckAnswer,
  RubberDuckClient,
  RubberDuckProvider,
} from '../../src/rubber-duck/types.js';

class FakeClient implements RubberDuckClient {
  readonly asks: Array<{ provider: string; prompt: string; signal?: AbortSignal }> = [];
  closeCalls = 0;

  constructor(readonly directory: string) {}

  listProviders(): Promise<RubberDuckProvider[]> {
    return Promise.resolve([{ name: 'duck-a', nickname: 'Duck A', model: 'model-a', type: 'cli' }]);
  }

  ask(provider: string, prompt: string, signal?: AbortSignal): Promise<RubberDuckAnswer> {
    this.asks.push({ provider, prompt, signal });
    return Promise.resolve({ content: 'READY', model: 'model-a' });
  }

  close(): Promise<void> {
    this.closeCalls++;
    return Promise.resolve();
  }
}

describe('RubberDuckResearchGateway', () => {
  it('reuses one MCP client per working directory and isolates different sessions', async () => {
    const clients: FakeClient[] = [];
    const gateway = new RubberDuckResearchGateway((directory) => {
      const client = new FakeClient(directory);
      clients.push(client);
      return client;
    });
    const controller = new AbortController();

    await expect(gateway.listProviders('/sessions/one')).resolves.toEqual([
      { name: 'duck-a', nickname: 'Duck A', model: 'model-a', type: 'cli' },
    ]);
    await expect(gateway.healthCheck('duck-a', '/sessions/one', controller.signal)).resolves.toBe(
      true
    );
    await expect(
      gateway.complete('duck-a', 'prompt', {
        workingDirectory: '/sessions/two',
        signal: controller.signal,
      })
    ).resolves.toEqual({ content: 'READY', model: 'model-a' });

    expect(clients.map((client) => client.directory)).toEqual(['/sessions/one', '/sessions/two']);
    expect(clients[0].asks[0].signal).toBe(controller.signal);

    await gateway.close();
    expect(clients.map((client) => client.closeCalls)).toEqual([1, 1]);
  });
});
