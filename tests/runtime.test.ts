import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ResearchSessionStore } from '../src/research/store.js';
import { createCouncilRuntime, withCouncilRuntime } from '../src/runtime.js';
import type {
  RubberDuckAnswer,
  RubberDuckClient,
  RubberDuckProvider,
} from '../src/rubber-duck/types.js';

class FakeClient implements RubberDuckClient {
  closes = 0;

  listProviders(): Promise<RubberDuckProvider[]> {
    return Promise.resolve([]);
  }

  ask(): Promise<RubberDuckAnswer> {
    return Promise.resolve({ content: '', model: '' });
  }

  close(): Promise<void> {
    this.closes++;
    return Promise.resolve();
  }
}

describe('Council runtime ownership', () => {
  it('constructs the shared service and closes every created Rubber Duck client', async () => {
    const store = new ResearchSessionStore(mkdtempSync(join(tmpdir(), 'hc-runtime-')));
    const client = new FakeClient();
    const runtime = createCouncilRuntime(store, () => client);

    await runtime.gateway.listProviders('/session');
    expect(runtime.service.store).toBe(store);
    await runtime.close();
    expect(client.closes).toBe(1);
  });

  it('closes the runtime when an operation fails', async () => {
    let closes = 0;
    const runtime = {
      service: {} as never,
      gateway: {} as never,
      close: () => {
        closes++;
        return Promise.resolve();
      },
    };

    await expect(
      withCouncilRuntime(runtime, () => Promise.reject(new Error('operation failed')))
    ).rejects.toThrow('operation failed');
    expect(closes).toBe(1);
  });
});
