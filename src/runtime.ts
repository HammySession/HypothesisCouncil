import { HypothesisCouncilService } from './research/orchestrator.js';
import { RubberDuckResearchGateway } from './research/provider-gateway.js';
import { ResearchSessionStore } from './research/store.js';
import type { RubberDuckClientFactory } from './rubber-duck/types.js';

export interface CouncilRuntime {
  service: HypothesisCouncilService;
  gateway: RubberDuckResearchGateway;
  close(): Promise<void>;
}

export type CouncilRuntimeFactory = (store: ResearchSessionStore) => CouncilRuntime;

export function createCouncilRuntime(
  store: ResearchSessionStore,
  clientFactory?: RubberDuckClientFactory
): CouncilRuntime {
  const gateway = new RubberDuckResearchGateway(clientFactory);
  return {
    service: new HypothesisCouncilService(gateway, store),
    gateway,
    close: () => gateway.close(),
  };
}

export async function withCouncilRuntime<T>(
  runtime: CouncilRuntime,
  operation: (runtime: CouncilRuntime) => Promise<T>
): Promise<T> {
  try {
    return await operation(runtime);
  } finally {
    await runtime.close();
  }
}
