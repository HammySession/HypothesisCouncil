import { createRubberDuckClient } from '../rubber-duck/client.js';
import type { RubberDuckClient, RubberDuckClientFactory } from '../rubber-duck/types.js';
import type {
  ProviderDescriptor,
  ResearchCompletion,
  ResearchCompletionOptions,
  ResearchProviderGateway,
} from './types.js';

export class RubberDuckResearchGateway implements ResearchProviderGateway {
  private readonly clients = new Map<string, RubberDuckClient>();

  constructor(private readonly clientFactory: RubberDuckClientFactory = createRubberDuckClient) {}

  async listProviders(
    workingDirectory: string,
    signal?: AbortSignal
  ): Promise<ProviderDescriptor[]> {
    return this.client(workingDirectory).listProviders(signal);
  }

  async healthCheck(
    provider: string,
    workingDirectory: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    try {
      const response = await this.client(workingDirectory).ask(
        provider,
        'Reply with exactly READY. Do not inspect, create, or modify files.',
        signal
      );
      return response.content.trim().length > 0;
    } catch {
      return false;
    }
  }

  async complete(
    provider: string,
    prompt: string,
    options: ResearchCompletionOptions
  ): Promise<ResearchCompletion> {
    const response = await this.client(options.workingDirectory).ask(
      provider,
      prompt,
      options.signal
    );
    return { content: response.content, model: response.model };
  }

  async close(): Promise<void> {
    const clients = [...this.clients.values()];
    this.clients.clear();
    const results = await Promise.allSettled(clients.map((client) => client.close()));
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (failure) throw failure.reason;
  }

  private client(workingDirectory: string): RubberDuckClient {
    let client = this.clients.get(workingDirectory);
    if (!client) {
      client = this.clientFactory(workingDirectory);
      this.clients.set(workingDirectory, client);
    }
    return client;
  }
}
