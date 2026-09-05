import { join } from 'path';
import { buildExecutorPrompt } from './prompts.js';
import { proposalBodyLines, renderTranscriptMarkdown } from './report.js';
import type { ProposalSessionStore } from './store.js';
import type {
  HandoffExecutor,
  HandoffRecord,
  HandoffTransport,
  ProposalSession,
  ProposalStage,
  ProposalStatus,
} from './types.js';

export interface HandoffOptions {
  repositoryPath: string;
  executor: HandoffExecutor;
  transport?: HandoffTransport;
}

export interface HandoffBundle {
  record: HandoffRecord;
  /** Absolute directory holding the bundle files. */
  directory: string;
  prompt: string;
}

export function nextHandoffId(session: ProposalSession): string {
  return `X-${String(session.handoffs.length + 1).padStart(3, '0')}`;
}

/** The proposal alone, as the executor sees it: no drafts, critiques, or provider names. */
export function handoffProposalMarkdown(session: ProposalSession): string {
  const proposal = session.proposal;
  if (!proposal) throw new Error(`Proposal ${session.id} has no merged proposal yet`);
  const lines = [
    `# ${proposal.title}`,
    '',
    `Proposal ${session.id}`,
    '',
    '## Topic',
    '',
    session.topic,
    '',
  ];
  lines.push(...proposalBodyLines(proposal));
  if (proposal.alternatives.length > 0) {
    lines.push('## Alternatives (not chosen; use only if the main design is killed)', '');
    for (const alternative of proposal.alternatives) lines.push(`- ${alternative}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Write the handoff bundle (`handoff/X-###/`): the proposal, the transcript, the context manifest,
 * and the executor prompt. Records the handoff on the session and marks it prepared.
 */
export function prepareHandoff(
  store: ProposalSessionStore,
  session: ProposalSession,
  options: HandoffOptions
): HandoffBundle {
  if (!session.proposal) throw new Error(`Proposal ${session.id} has no merged proposal yet`);
  const id = nextHandoffId(session);
  const relative = join('handoff', id);
  const proposalMarkdown = handoffProposalMarkdown(session);
  const transcriptMarkdown = renderTranscriptMarkdown(session);
  const contextPaths = session.contextManifest.files.map((file) => file.path);
  const prompt = buildExecutorPrompt({
    session,
    repositoryPath: options.repositoryPath,
    proposalMarkdown,
    transcriptMarkdown,
    contextPaths,
  });
  store.writeReport(session.id, join(relative, 'proposal.md'), proposalMarkdown);
  store.writeReport(session.id, join(relative, 'transcript.md'), transcriptMarkdown);
  store.writeReport(
    session.id,
    join(relative, 'context-manifest.json'),
    JSON.stringify(session.contextManifest, null, 2)
  );
  const promptPath = store.writeReport(session.id, join(relative, 'executor-prompt.md'), prompt);
  const record: HandoffRecord = {
    id,
    executor: options.executor,
    repositoryPath: options.repositoryPath,
    transport: options.transport ?? 'prompt-only',
    promptPath,
    status: 'prepared',
    startedAt: new Date().toISOString(),
  };
  session.handoffs.push(record);
  session.stage = 'handoff-prepared';
  store.save(session);
  return { record, directory: store.artifactPath(session.id, relative), prompt };
}

/** Merge a patch into one handoff record and move the session's stage and status. */
export function updateHandoff(
  store: ProposalSessionStore,
  sessionId: string,
  handoffId: string,
  patch: Partial<HandoffRecord>,
  transition?: { stage?: ProposalStage; status?: ProposalStatus }
): ProposalSession {
  const session = store.load(sessionId);
  const record = session.handoffs.find((item) => item.id === handoffId);
  if (!record) throw new Error(`Handoff not found: ${handoffId}`);
  Object.assign(record, patch);
  if (transition?.stage) session.stage = transition.stage;
  if (transition?.status) session.status = transition.status;
  store.save(session);
  return session;
}
