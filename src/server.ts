import { readFileSync } from 'fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { publicSessionSnapshot } from './research/report.js';
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

export class HypothesisCouncilServer {
  private readonly server = new McpServer({ name: 'hypothesis-council', version: '0.1.0' });

  constructor(
    private readonly store = new ResearchSessionStore(),
    private readonly runtimeFactory: CouncilRuntimeFactory = createCouncilRuntime
  ) {
    this.registerTools();
  }

  start(transport: Transport = new StdioServerTransport()): Promise<void> {
    return this.server.connect(transport);
  }

  stop(): Promise<void> {
    return this.server.close();
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
          const session = await withCouncilRuntime(this.runtimeFactory(this.store), ({ service }) =>
            service.run(
              {
                goal: input.goal,
                providers: input.providers,
                contextPaths: input.context_paths,
                contextRoot: input.context_root,
                markdownOnly: input.markdown_only,
                hypothesesPerProvider: input.hypotheses_per_provider,
                topK: input.top_k,
                minProviders: input.min_providers,
                seed: input.seed,
                maxContextBytes: input.max_context_bytes,
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
