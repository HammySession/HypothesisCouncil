import { HypothesisCouncilService } from './research/orchestrator.js';
import { ResearchProposalService } from './research/proposal/service.js';
import { proposalStoreFor } from './research/proposal/store.js';
import { RubberDuckResearchGateway } from './research/provider-gateway.js';
import { createFetchSourceVerifier, type SourceVerifier } from './research/source-verify.js';
import { ResearchSessionStore } from './research/store.js';
import type { RubberDuckClientFactory } from './rubber-duck/types.js';

export interface CouncilRuntime {
  service: HypothesisCouncilService;
  /** Research proposal workflow sharing the gateway and the session home. */
  proposals: ResearchProposalService;
  gateway: RubberDuckResearchGateway;
  close(): Promise<void>;
}

export type CouncilRuntimeFactory = (store: ResearchSessionStore) => CouncilRuntime;

export interface CouncilRuntimeOptions {
  /** Replaces the fetch-based source verifier; tests use a fake so no URL is ever contacted. */
  sourceVerifier?: SourceVerifier;
}

export function createCouncilRuntime(
  store: ResearchSessionStore,
  clientFactory?: RubberDuckClientFactory,
  options: CouncilRuntimeOptions = {}
): CouncilRuntime {
  const gateway = new RubberDuckResearchGateway(clientFactory);
  return {
    service: new HypothesisCouncilService(gateway, store, {
      sourceVerifier: options.sourceVerifier ?? createFetchSourceVerifier(),
    }),
    proposals: new ResearchProposalService(gateway, proposalStoreFor(store), {
      councilStore: store,
    }),
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
