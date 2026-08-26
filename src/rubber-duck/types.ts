export type RubberDuckProviderType = 'cli' | 'http' | 'unknown';

export interface RubberDuckProvider {
  name: string;
  nickname: string;
  model: string;
  type: RubberDuckProviderType;
}

export interface RubberDuckAnswer {
  content: string;
  model: string;
}

export interface RubberDuckClient {
  listProviders(signal?: AbortSignal): Promise<RubberDuckProvider[]>;
  ask(provider: string, prompt: string, signal?: AbortSignal): Promise<RubberDuckAnswer>;
  close(): Promise<void>;
}

export type RubberDuckClientFactory = (workingDirectory: string) => RubberDuckClient;
