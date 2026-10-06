import {
  isProposalId,
  proposalStoreFor,
  type ProposalSessionStore,
} from '../../research/proposal/store.js';
import type { ProposalSession } from '../../research/proposal/types.js';
import type { ShellContext } from './context.js';

export const NO_PROPOSAL_SELECTED =
  'No proposal selected; start one with /propose "<topic>" or select one with /use RP-...';

export function proposalStore(ctx: Pick<ShellContext, 'store'>): ProposalSessionStore {
  return proposalStoreFor(ctx.store);
}

/** True when the shell's selected session is a proposal (`RP-...`). */
export function proposalSelected(ctx: Pick<ShellContext, 'state'>): boolean {
  return !!ctx.state.selectedSession && isProposalId(ctx.state.selectedSession);
}

export function selectedProposalId(ctx: Pick<ShellContext, 'state'>): string {
  if (!proposalSelected(ctx)) throw new Error(NO_PROPOSAL_SELECTED);
  return ctx.state.selectedSession!;
}

export function loadSelectedProposal(ctx: Pick<ShellContext, 'state' | 'store'>): ProposalSession {
  return proposalStore(ctx).load(selectedProposalId(ctx));
}
