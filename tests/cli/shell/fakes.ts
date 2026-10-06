import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { CliDependencies } from '../../../src/cli/dependencies.js';
import type { CommandRunner } from '../../../src/cli/model-discovery.js';
import { createShellState, type ShellContext } from '../../../src/cli/shell/context.js';
import { createMemoryIO, type MemoryIO, type MemoryIOOptions } from '../../../src/cli/shell/io.js';
import { ResearchSessionStore } from '../../../src/research/store.js';
import type {
  HypothesisCandidate,
  HypothesisReview,
  ResearchSession,
} from '../../../src/research/types.js';
import { createCouncilRuntime } from '../../../src/runtime.js';
import { skippedVerifier, type SourceVerifier } from '../../../src/research/source-verify.js';
import type {
  RubberDuckAnswer,
  RubberDuckClient,
  RubberDuckProvider,
} from '../../../src/rubber-duck/types.js';

export interface ScriptedReply {
  /** Provider name the reply applies to; omit for any provider. */
  provider?: string;
  /** Prompt prefix the reply applies to; omit for any prompt. */
  promptStartsWith?: string;
  /** Substring the prompt must contain; omit for any prompt. */
  promptIncludes?: string;
  content?: string;
  error?: Error;
}

export interface RecordedAsk {
  provider: string;
  prompt: string;
  workingDirectory: string;
}

/** A Rubber Duck client scripted by provider and prompt; records every ask. */
export class FakeRubberDuckClient implements RubberDuckClient {
  readonly asks: RecordedAsk[] = [];
  closes = 0;

  constructor(
    readonly providers: RubberDuckProvider[],
    private readonly replies: ScriptedReply[] = [],
    readonly workingDirectory = ''
  ) {}

  listProviders(): Promise<RubberDuckProvider[]> {
    return Promise.resolve(this.providers.map((provider) => ({ ...provider })));
  }

  ask(provider: string, prompt: string): Promise<RubberDuckAnswer> {
    this.asks.push({ provider, prompt, workingDirectory: this.workingDirectory });
    const reply = this.replies.find(
      (item) =>
        (item.provider === undefined || item.provider === provider) &&
        (item.promptStartsWith === undefined || prompt.startsWith(item.promptStartsWith)) &&
        (item.promptIncludes === undefined || prompt.includes(item.promptIncludes))
    );
    if (!reply) return Promise.reject(new Error(`No scripted reply for ${provider}`));
    if (reply.error) return Promise.reject(reply.error);
    const descriptor = this.providers.find((item) => item.name === provider);
    return Promise.resolve({ content: reply.content ?? '', model: descriptor?.model ?? 'model' });
  }

  close(): Promise<void> {
    this.closes++;
    return Promise.resolve();
  }
}

export const TEST_PROVIDERS: RubberDuckProvider[] = [
  { name: 'duck-a', nickname: 'Duck A', model: 'model-a', type: 'cli' },
  { name: 'duck-b', nickname: 'Duck B', model: 'model-b', type: 'cli' },
];

export interface TestContextOptions {
  store?: ResearchSessionStore;
  providers?: RubberDuckProvider[];
  replies?: ScriptedReply[];
  io?: MemoryIOOptions;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  cwd?: string;
  /** Commands `locateCommand` reports as present. */
  commandsOnPath?: string[];
  /** Vendor configuration directory; defaults to an empty temp dir so discovery finds nothing. */
  homeDirectory?: string;
  /**
   * Whether the person configured Rubber Duck themselves (a config file in the home directory).
   * Defaults to true, so the fake ducks are used as they are; false makes the CLI choose the auto
   * preset from `commandsOnPath`.
   */
  rubberDuckConfigured?: boolean;
  /** Fake vendor listing runner; defaults to rejecting every command. */
  runVendorCommand?: CommandRunner;
  /** Source verifier for the sources stage; defaults to one that skips every fetch. */
  sourceVerifier?: SourceVerifier;
}

export interface TestContext extends ShellContext {
  io: MemoryIO;
  clients: FakeRubberDuckClient[];
  opened: string[];
  progressFinished: number;
}

export function createTestStore(): ResearchSessionStore {
  return new ResearchSessionStore(mkdtempSync(join(tmpdir(), 'hc-shell-')));
}

export function createTestContext(options: TestContextOptions = {}): TestContext {
  const store = options.store ?? createTestStore();
  const io = createMemoryIO(options.io);
  const clients: FakeRubberDuckClient[] = [];
  const opened: string[] = [];
  const commandsOnPath = new Set(options.commandsOnPath ?? []);
  const homeDirectory = options.homeDirectory ?? mkdtempSync(join(tmpdir(), 'hc-home-'));
  if (options.rubberDuckConfigured ?? true) {
    const configDirectory = join(homeDirectory, '.mcp-rubber-duck');
    mkdirSync(configDirectory, { recursive: true });
    writeFileSync(join(configDirectory, 'config.json'), '{"providers":{}}\n');
  }
  const context: TestContext = {
    io,
    env: options.env ?? {},
    envSnapshot: { ...(options.env ?? {}) },
    platform: options.platform ?? 'linux',
    homeDirectory,
    runVendorCommand:
      options.runVendorCommand ??
      ((command) => Promise.reject(new Error(`vendor command not available in tests: ${command}`))),
    cwd: options.cwd ?? mkdtempSync(join(tmpdir(), 'hc-repo-')),
    runtimeFactory: (runtimeStore) =>
      createCouncilRuntime(
        runtimeStore,
        (workingDirectory) => {
          const client = new FakeRubberDuckClient(
            options.providers ?? TEST_PROVIDERS,
            options.replies ?? [],
            workingDirectory
          );
          clients.push(client);
          return client;
        },
        { sourceVerifier: options.sourceVerifier ?? skippedVerifier }
      ),
    openInBrowser: (path) => void opened.push(path),
    locateCommand: (command) => (commandsOnPath.has(command) ? `/bin/${command}` : undefined),
    now: () => 1_000,
    createProgressRenderer: () => ({
      handle: () => undefined,
      finish: () => {
        context.progressFinished++;
      },
    }),
    rubberDuckVersion: () => '1.20.5',
    store,
    state: createShellState(store, options.cwd ?? '.'),
    clients,
    opened,
    progressFinished: 0,
  };
  context.state.repoRoot = context.cwd;
  return context;
}

export function dependenciesOf(context: TestContext): CliDependencies {
  return context;
}

function candidate(id: string, rank: number, score: number): HypothesisCandidate {
  return {
    id,
    sessionId: 'RC-1',
    generationIndex: 0,
    authorProvider: 'duck-a',
    status: 'distinct',
    rank,
    score,
    createdAt: '2026-08-27T00:00:00.000Z',
    title: `Title ${id}`,
    claim: 'claim',
    mechanism: 'mechanism',
    predictions: ['prediction'],
    assumptions: [],
    falsifier: 'falsifier',
    minimalExperiment: 'experiment',
    confidence: 0.5,
  };
}

function review(hypothesisId: string, verdict: HypothesisReview['verdict']): HypothesisReview {
  return {
    id: `RV-${hypothesisId}`,
    sessionId: 'RC-1',
    hypothesisId,
    reviewerProvider: 'duck-b',
    selfReview: false,
    createdAt: '2026-08-27T00:00:00.000Z',
    plausibility: 7,
    novelty: 7,
    testability: 7,
    falsifiability: 7,
    feasibility: 7,
    robustness: 7,
    fatalFlaw: null,
    strongestObjection: 'objection',
    hiddenAssumptions: [],
    proposedDiscriminatingTest: 'test',
    verdict,
    confidence: 0.7,
  };
}

/** Persist a completed two-candidate session with a Markdown report and make it current. */
export function seedSession(
  store: ResearchSessionStore,
  overrides: Partial<ResearchSession> = {}
): ResearchSession {
  const id = overrides.id ?? 'RC-20260827-000000Z-abc123';
  const session: ResearchSession = {
    version: 1,
    id,
    goal: 'Explain the drift',
    status: 'completed',
    stage: 'completed',
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:06:00.000Z',
    config: {
      providers: ['duck-a', 'duck-b'],
      hypothesesPerProvider: 2,
      topK: 1,
      minProviders: 2,
      seed: 42,
      maxContextBytes: 4096,
      contextPaths: ['.'],
      contextRoot: '/repo',
      markdownOnly: false,
      contextBudget: { maxBytes: 4096, limitingProvider: 'duck-a', providerLimits: [] },
    },
    providers: ['duck-a', 'duck-b'],
    unavailableProviders: [],
    contextManifest: {
      files: [],
      deniedPaths: [],
      omittedPaths: [],
      totalBytes: 0,
      includedBytes: 1024,
      packetBytes: 1024,
      maxBytes: 4096,
      packetSha256: 'abc',
    },
    candidates: [candidate('H-002', 1, 7.5), candidate('H-001', 2, 6.25)].map((item) => ({
      ...item,
      sessionId: id,
    })),
    reviews: [review('H-002', 'accept'), review('H-001', 'weak_accept')].map((item) => ({
      ...item,
      sessionId: id,
    })),
    falsifications: [],
    calls: [],
    warnings: [],
    ...overrides,
  };
  session.reportMarkdownPath = store.writeReport(
    session.id,
    'report.md',
    `# Hypothesis Council report\n\nGoal: ${session.goal}\n\n- **H-002** Title H-002\n`
  );
  session.reportJsonPath = store.writeReport(
    session.id,
    'report.json',
    JSON.stringify({ id: session.id, goal: session.goal })
  );
  store.save(session);
  return session;
}
