import { readFileSync } from 'fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { publicProposalSnapshot } from './research/proposal/public.js';
import { renderProposalMarkdown } from './research/proposal/report.js';
import { proposalStoreFor } from './research/proposal/store.js';
import type { ProposalSession } from './research/proposal/types.js';
import { publicSessionSnapshot } from './research/report.js';
import { dialsFromSettings, resolveSettings, type DialConfig } from './research/settings.js';
import { loadSettingsFile, settingsPath } from './research/settings-store.js';
import { VERSION } from './version.js';
import { ResearchSessionStore } from './research/store.js';
import { createCouncilRuntime, withCouncilRuntime, type CouncilRuntimeFactory } from './runtime.js';

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function errorResult(error: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
  };
}

const DialInputSchema = z.union([z.number(), z.string()]).optional();

export class HypothesisCouncilServer {
  private readonly server = new McpServer({ name: 'hypothesis-council', version: VERSION });

  constructor(
    private readonly store = new ResearchSessionStore(),
    private readonly runtimeFactory: CouncilRuntimeFactory = createCouncilRuntime,
    private readonly environment: NodeJS.ProcessEnv = process.env
  ) {
    this.registerTools();
  }

  start(transport: Transport = new StdioServerTransport()): Promise<void> {
    return this.server.connect(transport);
  }

  stop(): Promise<void> {
    return this.server.close();
  }

  /** Tool inputs win, then the environment, then the settings file in the session home. */
  private resolveDials(input: { novelty?: unknown; skepticism?: unknown }): DialConfig {
    const filePath = settingsPath(this.store.root);
    return dialsFromSettings(
      resolveSettings({
        flags: { novelty: input.novelty, skepticism: input.skepticism },
        env: this.environment,
        file: loadSettingsFile(filePath),
        filePath,
      })
    );
  }

  private registerTools(): void {
    this.server.registerTool(
      'duck_hypothesis_council',
      {
        title: 'Hypothesis Council',
        description:
          'Independently generate, blindly review, falsify, and persist inspectable hypotheses.',
        inputSchema: {
          goal: z.string().min(1),
          providers: z.array(z.string()).optional(),
          context_paths: z.array(z.string()).optional(),
          context_root: z.string().optional(),
          markdown_only: z.boolean().optional(),
          hypotheses_per_provider: z.number().int().min(1).max(10).optional(),
          top_k: z.number().int().min(1).max(10).optional(),
          min_providers: z.number().int().min(1).optional(),
          seed: z.number().int().optional(),
          max_context_bytes: z
            .number()
            .int()
            .min(1024)
            .max(16 * 1024 * 1024)
            .optional(),
          novelty: DialInputSchema,
          skepticism: DialInputSchema,
          sources_file: z.string().optional(),
          scouts: z.array(z.string()).optional(),
          web: z.enum(['on', 'off']).optional(),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async (input, extra) => {
        try {
          const dials = this.resolveDials(input);
          const session = await withCouncilRuntime(this.runtimeFactory(this.store), ({ service }) =>
            service.run(
              {
                goal: input.goal,
                sourcesFile: input.sources_file,
                scouts: input.scouts,
                web: input.web,
                providers: input.providers,
                contextPaths: input.context_paths,
                contextRoot: input.context_root,
                markdownOnly: input.markdown_only,
                hypothesesPerProvider: input.hypotheses_per_provider,
                topK: input.top_k,
                minProviders: input.min_providers,
                seed: input.seed,
                maxContextBytes: input.max_context_bytes,
                dials,
              },
              undefined,
              extra.signal
            )
          );
          return textResult(
            JSON.stringify(
              {
                sessionId: session.id,
                status: session.status,
                candidates: session.candidates.filter(
                  (candidate) => candidate.status === 'distinct'
                ).length,
                report: session.reportMarkdownPath,
              },
              null,
              2
            )
          );
        } catch (error) {
          return errorResult(error);
        }
      }
    );

    this.server.registerTool(
      'duck_hypothesis_status',
      {
        title: 'Hypothesis Council Status',
        description: 'Inspect the durable state of a hypothesis council session.',
        inputSchema: { session_id: z.string().optional() },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      (input) => {
        try {
          return textResult(
            JSON.stringify(publicSessionSnapshot(this.store.load(input.session_id)), null, 2)
          );
        } catch (error) {
          return errorResult(error);
        }
      }
    );

    this.server.registerTool(
      'duck_hypothesis_report',
      {
        title: 'Hypothesis Council Report',
        description: 'Read the Markdown report for a completed hypothesis council session.',
        inputSchema: { session_id: z.string().optional() },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      (input) => {
        try {
          const session = this.store.load(input.session_id);
          if (!session.reportMarkdownPath) throw new Error(`Report is not ready for ${session.id}`);
          return textResult(readFileSync(session.reportMarkdownPath, 'utf8'));
        } catch (error) {
          return errorResult(error);
        }
      }
    );

    this.server.registerTool(
      'duck_research_proposal',
      {
        title: 'Research Proposal',
        description:
          'Start a research proposal on a topic: the council interviews you (answer with duck_research_proposal_answer), drafts independently, critiques blind, and merges one proposal. Returns the public proposal state; with interview=false or answers the proposal is drafted immediately.',
        inputSchema: {
          topic: z.string().min(1),
          providers: z.array(z.string()).optional(),
          context_paths: z.array(z.string()).optional(),
          context_root: z.string().optional(),
          markdown_only: z.boolean().optional(),
          from_session_id: z.string().optional(),
          interview: z.boolean().optional(),
          max_rounds: z.number().int().min(1).max(5).optional(),
          answers: z.record(z.string().nullable()).optional(),
          novelty: DialInputSchema,
          skepticism: DialInputSchema,
        },
        annotations: { readOnlyHint: false, openWorldHint: true },
      },
      async (input, extra) => {
        try {
          const dials = this.resolveDials(input);
          const session = await withCouncilRuntime(
            this.runtimeFactory(this.store),
            async ({ proposals }) => {
              let current = await proposals.start(
                {
                  topic: input.topic,
                  providers: input.providers,
                  contextPaths: input.context_paths,
                  contextRoot: input.context_root,
                  markdownOnly: input.markdown_only,
                  fromSessionId: input.from_session_id,
                  interview: input.interview,
                  maxRounds: input.max_rounds,
                  dials,
                },
                undefined,
                extra.signal
              );
              if (input.answers && current.stage === 'awaiting-answers') {
                current = proposals.answer(current.id, input.answers);
              }
              if (current.stage === 'interview-complete') {
                current = await proposals.draft(current.id, undefined, extra.signal);
              }
              return current;
            }
          );
          return textResult(JSON.stringify(publicProposalSnapshot(session), null, 2));
        } catch (error) {
          return errorResult(error);
        }
      }
    );

    this.server.registerTool(
      'duck_research_proposal_answer',
      {
        title: 'Answer Research Proposal Interview',
        description:
          'Answer or skip (null) open interview questions of a research proposal. next_round asks the council for another round once everything is answered; finish ends the interview early; the proposal is drafted as soon as the interview is complete unless draft=false.',
        inputSchema: {
          session_id: z.string().optional(),
          answers: z.record(z.string().nullable()).optional(),
          next_round: z.boolean().optional(),
          finish: z.boolean().optional(),
          draft: z.boolean().optional(),
        },
        annotations: { readOnlyHint: false, openWorldHint: true },
      },
      async (input, extra) => {
        try {
          const session = await withCouncilRuntime(
            this.runtimeFactory(this.store),
            async ({ proposals }) => {
              let current: ProposalSession = proposals.store.load(input.session_id);
              if (input.answers && Object.keys(input.answers).length > 0) {
                current = proposals.answer(current.id, input.answers);
              }
              if (input.finish && current.stage === 'awaiting-answers') {
                current = proposals.finishInterview(current.id);
              }
              if (input.next_round && current.stage === 'awaiting-answers') {
                current = await proposals.nextRound(current.id, undefined, extra.signal);
              }
              if (current.stage === 'interview-complete' && input.draft !== false) {
                current = await proposals.draft(current.id, undefined, extra.signal);
              }
              return current;
            }
          );
          return textResult(JSON.stringify(publicProposalSnapshot(session), null, 2));
        } catch (error) {
          return errorResult(error);
        }
      }
    );

    this.server.registerTool(
      'duck_research_proposal_report',
      {
        title: 'Research Proposal Report',
        description:
          'Read the Markdown of a merged research proposal (interview transcript, ranked drafts, and the proposal).',
        inputSchema: { session_id: z.string().optional() },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      (input) => {
        try {
          const session = proposalStoreFor(this.store).load(input.session_id);
          if (!session.proposal) {
            throw new Error(`Proposal is not ready for ${session.id} (stage: ${session.stage})`);
          }
          return textResult(renderProposalMarkdown(session));
        } catch (error) {
          return errorResult(error);
        }
      }
    );

    this.server.registerTool(
      'duck_hypothesis_ask',
      {
        title: 'Ask About a Hypothesis Session',
        description: 'Ask a read-only question grounded in a persisted hypothesis session.',
        inputSchema: {
          question: z.string().min(1),
          session_id: z.string().optional(),
          provider: z.string().optional(),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async (input, extra) => {
        try {
          const answer = await withCouncilRuntime(this.runtimeFactory(this.store), ({ service }) =>
            service.ask(input.session_id, input.question, input.provider, [], extra.signal)
          );
          return textResult(answer);
        } catch (error) {
          return errorResult(error);
        }
      }
    );
  }
}
