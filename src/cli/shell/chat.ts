import { calculateContextBudget } from '../../research/context-budget.js';
import type { BuiltContext } from '../../research/context.js';
import type { HypothesisCouncilService } from '../../research/orchestrator.js';
import type { ResearchProposalService } from '../../research/proposal/service.js';
import type { ProposalSession } from '../../research/proposal/types.js';
import type {
  ProviderDescriptor,
  ResearchProviderGateway,
  ResearchSession,
} from '../../research/types.js';
import { withCouncilRuntime } from '../../runtime.js';
import { formatDuration } from '../format.js';
import { addBasketPaths, basketPreviewLines, basketSize, buildBasketPacket } from './basket.js';
import { chatTurns, priorTurnLines, rememberProviders, type ShellContext } from './context.js';
import { loadSelectedProposal, proposalSelected } from './proposal-scope.js';
import { resolveProviderSelection, splitMentions, type ProviderName } from './providers.js';

/** Bytes kept free for the chat framing and question when a basket packet is attached. */
export const CHAT_PACKET_OVERHEAD_BYTES = 8 * 1024;

export const CONTEXT_CONFIRMATION_REQUIRED =
  'The context basket is sent to external providers; confirm it in a terminal, or empty it with /context clear.';

/** The free-chat prompt: optional user-provided context, the last turns, and the question. */
export function buildChatPrompt(
  turns: ReturnType<typeof chatTurns>,
  question: string,
  contextPacket?: string
): string {
  const lines = [...priorTurnLines(turns).slice(-6), `User: ${question}`];
  if (!contextPacket) return lines.join('\n');
  return `CONTEXT (provided by the user; answer from it where relevant)\n${contextPacket}\n\n${lines.join('\n')}`;
}

export interface ChatReply {
  provider: string;
  model?: string;
  text?: string;
  error?: string;
  elapsedMs: number;
}

/** One reply prints bare; several are labelled with provider, model, and elapsed time. */
export function replyText(replies: ChatReply[]): string {
  if (replies.length === 1 && replies[0].text !== undefined) return replies[0].text;
  return replies
    .map((reply) => {
      const label = [reply.provider, reply.model, formatDuration(reply.elapsedMs)]
        .filter(Boolean)
        .join(' · ');
      return `[${label}]\n${reply.text ?? `error: ${reply.error ?? 'no reply'}`}`;
    })
    .join('\n\n');
}

export interface AskProvidersOptions {
  service: HypothesisCouncilService;
  gateway: ResearchProviderGateway;
  session?: ResearchSession;
  /** A selected research proposal; questions are grounded in it through the proposal service. */
  proposal?: ProposalSession;
  proposals?: ResearchProposalService;
  workingDirectory: string;
  contextPacket?: string;
}

/**
 * Ask several providers the same question in parallel, each with its own history. A failure in
 * one reply never hides the others; only when every provider fails does the call throw.
 */
export async function askProviders(
  ctx: ShellContext,
  providers: readonly string[],
  question: string,
  options: AskProvidersOptions
): Promise<ChatReply[]> {
  const settled = await Promise.allSettled(
    providers.map(async (provider): Promise<ChatReply> => {
      const turns = chatTurns(ctx.state, provider);
      const startedAt = ctx.now();
      let text: string;
      let model: string | undefined;
      if (options.session) {
        text = await options.service.ask(
          options.session.id,
          question,
          provider,
          priorTurnLines(turns),
          ctx.signal,
          options.contextPacket
        );
      } else if (options.proposal && options.proposals) {
        text = await options.proposals.ask(
          options.proposal.id,
          question,
          provider,
          priorTurnLines(turns),
          ctx.signal,
          options.contextPacket
        );
      } else {
        const completion = await options.gateway.complete(
          provider,
          buildChatPrompt(turns, question, options.contextPacket),
          { workingDirectory: options.workingDirectory, signal: ctx.signal }
        );
        text = completion.content;
        model = completion.model;
      }
      turns.push({ role: 'user', text: question }, { role: 'duck', text });
      return { provider, model, text, elapsedMs: ctx.now() - startedAt };
    })
  );
  const replies = settled.map((result, index): ChatReply => {
    if (result.status === 'fulfilled') return result.value;
    const reason: unknown = result.reason;
    return {
      provider: providers[index],
      error: reason instanceof Error ? reason.message : String(reason),
      elapsedMs: 0,
    };
  });
  if (replies.every((reply) => reply.text === undefined)) {
    throw new Error(
      replies.map((reply) => `${reply.provider}: ${reply.error ?? 'no reply'}`).join('\n')
    );
  }
  return replies;
}

/** Budget for a basket packet attached to a chat message. */
export function chatPacketBudget(
  ctx: ShellContext,
  descriptors: readonly ProviderDescriptor[],
  providers: readonly string[],
  session?: { config: { maxContextBytes: number } }
): number {
  const shared = session
    ? session.config.maxContextBytes
    : calculateContextBudget([...descriptors], [...providers], undefined, ctx.env, ctx.platform)
        .maxBytes;
  return Math.max(1024, shared - CHAT_PACKET_OVERHEAD_BYTES);
}

/**
 * Build the basket packet and ask once per distinct packet whether it may be sent. Returns
 * undefined when the basket is empty.
 */
export async function confirmBasketPacket(
  ctx: ShellContext,
  maxBytes: number
): Promise<BuiltContext | undefined> {
  const { state, io } = ctx;
  if (basketSize(state.basket) === 0) return undefined;
  const built = buildBasketPacket(state.basket, state.repoRoot, maxBytes);
  if (state.confirmedPackets.has(built.manifest.packetSha256)) return built;
  for (const line of basketPreviewLines(built, state.basket)) io.err(line);
  if (!io.isInteractive) throw new Error(CONTEXT_CONFIRMATION_REQUIRED);
  const approved = await io.confirm('Send this context with your message?');
  if (!approved) throw new Error('Chat cancelled; nothing was sent.');
  state.confirmedPackets.add(built.manifest.packetSha256);
  return built;
}

function descriptorsFor(
  session: { providers: string[] } | undefined,
  listed: ProviderDescriptor[]
) {
  if (!session) return listed;
  return session.providers.map(
    (name): ProviderDescriptor =>
      listed.find((item) => item.name === name) ?? {
        name,
        nickname: name,
        model: 'provider-default',
        type: 'unknown',
      }
  );
}

/**
 * Plain text in the shell. `@provider` mentions pick who answers this message and `@path`
 * mentions add to the context basket. With a session selected, questions are grounded in its
 * persisted candidates through the research service; otherwise the selected ducks chat freely.
 */
export async function chatFallback(ctx: ShellContext, text: string): Promise<void> {
  const { state, store, io } = ctx;
  const proposal = proposalSelected(ctx) ? loadSelectedProposal(ctx) : undefined;
  const session =
    state.selectedSession && !proposal ? store.load(state.selectedSession) : undefined;
  const scope = proposal ?? session;
  const answer = await withCouncilRuntime(
    ctx.runtimeFactory(store),
    async ({ service, proposals, gateway }) => {
      const workingDirectory = scope
        ? store.sessionDirectory(scope.id)
        : store.sessionDirectory('chat');
      const listed = scope ? [] : await gateway.listProviders(workingDirectory, ctx.signal);
      const descriptors = descriptorsFor(scope, listed);
      rememberProviders(
        state,
        descriptors.map((item) => item.name)
      );
      const names: ProviderName[] = descriptors;
      const mentions = splitMentions(text, names);
      if (mentions.paths.length > 0) {
        const result = addBasketPaths(state.basket, mentions.paths, state.repoRoot);
        if (result.added.length > 0) io.err(`Context basket: added ${result.added.join(', ')}`);
        if (result.missing.length > 0) {
          throw new Error(`Not found under ${state.repoRoot}: ${result.missing.join(', ')}`);
        }
      }
      const question = mentions.text;
      if (!question) throw new Error('Nothing to ask after the mentions; add a question.');
      const providers =
        mentions.providers.length > 0
          ? mentions.providers
          : resolveProviderSelection(state.selection, names, scope?.providers[0]);
      const packet = await confirmBasketPacket(
        ctx,
        chatPacketBudget(ctx, descriptors, providers, scope)
      );
      const replies = await askProviders(ctx, providers, question, {
        service,
        gateway,
        session,
        proposal,
        proposals,
        workingDirectory,
        contextPacket: packet?.packet,
      });
      if (!scope && state.selection.kind === 'auto' && mentions.providers.length === 0) {
        state.selection = { kind: 'named', names: providers };
      }
      return replyText(replies);
    }
  );
  io.out(answer);
}
