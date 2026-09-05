import { SessionStoreBase, type ResearchSessionStore } from '../store.js';
import type { ProposalSession } from './types.js';

/** Proposal sessions live beside council sessions under the same home, prefixed `RP-`. */
export class ProposalSessionStore extends SessionStoreBase<ProposalSession> {
  constructor(root?: string) {
    super(root, { idPrefix: 'RP-', currentFile: 'current-proposal' });
  }

  protected override missingCurrentMessage(): string {
    return 'No current research proposal';
  }

  protected override notFoundMessage(sessionId: string): string {
    return `Research proposal not found: ${sessionId}`;
  }
}

/** The proposal store sharing a council store's home directory. */
export function proposalStoreFor(store: Pick<ResearchSessionStore, 'root'>): ProposalSessionStore {
  return new ProposalSessionStore(store.root);
}

export function isProposalId(value: string): boolean {
  return /^RP-/i.test(value.trim());
}
