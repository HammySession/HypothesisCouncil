import type { ZodType } from 'zod';
import { parseStructuredOutput } from './parsing.js';
import type { SessionStoreBase, StoredSession } from './store.js';
import type {
  ProviderCallRecord,
  ResearchCompletion,
  ResearchProgress,
  ResearchProgressHandler,
  ResearchProviderGateway,
} from './types.js';

/** A persisted session that records provider calls and warnings. */
export interface CallHost extends StoredSession {
  calls: ProviderCallRecord[];
  warnings: string[];
}

export interface CallSpec {
  id: string;
  stage: ProviderCallRecord['stage'];
  provider: string;
  subject: string;
  promptVersion: string;
  prompt: string;
}

export interface ParsedCall<T> {
  parsed: T;
  completion: ResearchCompletion;
  callId: string;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Research session cancelled');
}

export async function emitProgress(
  progress: ResearchProgressHandler | undefined,
  stage: ResearchProgress['stage'],
  completed: number,
  total: number,
  message: string,
  details: Pick<ResearchProgress, 'subject' | 'event'> = {}
): Promise<void> {
  await progress?.({ stage, completed, total, message, ...details });
}

/**
 * Provider-call plumbing shared by every council workflow: each call runs in the session
 * directory, its raw reply is written as an artifact, and a call record is persisted whether it
 * succeeded or failed. Blank replies are retried once and unparseable replies get one repair call.
 */
export class CouncilCalls<T extends CallHost> {
  constructor(
    private readonly gateway: ResearchProviderGateway,
    private readonly store: SessionStoreBase<T>
  ) {}

  async invoke(host: T, spec: CallSpec, signal?: AbortSignal): Promise<ResearchCompletion> {
    throwIfAborted(signal);
    const startedAt = new Date().toISOString();
    const base = {
      id: spec.id,
      stage: spec.stage,
      provider: spec.provider,
      subject: spec.subject,
      promptVersion: spec.promptVersion,
      startedAt,
    };
    try {
      const completion = await this.gateway.complete(spec.provider, spec.prompt, {
        workingDirectory: this.store.sessionDirectory(host.id),
        signal,
      });
      const rawPath = this.store.writeCallArtifact(
        host.id,
        spec.stage,
        spec.id,
        'raw',
        completion.content
      );
      this.upsertCall(host, { ...base, endedAt: new Date().toISOString(), success: true, rawPath });
      return completion;
    } catch (error) {
      this.upsertCall(host, {
        ...base,
        endedAt: new Date().toISOString(),
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Run a call for a session that may be in use elsewhere (for example several `ask`s at once).
   * The record is merged into the latest persisted copy instead of saving the caller's snapshot,
   * so parallel callers never overwrite each other's call records.
   */
  async invokeDetached(
    hostId: string,
    spec: CallSpec,
    signal?: AbortSignal
  ): Promise<ResearchCompletion> {
    throwIfAborted(signal);
    const startedAt = new Date().toISOString();
    const base = {
      id: spec.id,
      stage: spec.stage,
      provider: spec.provider,
      subject: spec.subject,
      promptVersion: spec.promptVersion,
      startedAt,
    };
    try {
      const completion = await this.gateway.complete(spec.provider, spec.prompt, {
        workingDirectory: this.store.sessionDirectory(hostId),
        signal,
      });
      const rawPath = this.store.writeCallArtifact(
        hostId,
        spec.stage,
        spec.id,
        'raw',
        completion.content
      );
      this.mergeCall(hostId, {
        ...base,
        endedAt: new Date().toISOString(),
        success: true,
        rawPath,
      });
      return completion;
    } catch (error) {
      this.mergeCall(hostId, {
        ...base,
        endedAt: new Date().toISOString(),
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private mergeCall(hostId: string, record: ProviderCallRecord): void {
    const latest = this.store.load(hostId);
    this.upsertCall(latest, record);
  }

  async invokeWithBlankRetry(
    host: T,
    spec: CallSpec,
    signal?: AbortSignal
  ): Promise<{ completion: ResearchCompletion; callId: string }> {
    let completion = await this.invoke(host, spec, signal);
    if (completion.content.trim()) return { completion, callId: spec.id };
    // A blank reply is a transport or provider hiccup, not an answer. Re-issue the same sealed
    // prompt once; nothing from another provider is involved.
    host.warnings.push(`Empty ${spec.stage} response from ${spec.provider}; retried once`);
    const callId = spec.id.replace(/^([^-]+)-/, '$1-retry-');
    completion = await this.invoke(host, { ...spec, id: callId }, signal);
    if (!completion.content.trim()) throw new Error('Empty response after retry');
    return { completion, callId };
  }

  /**
   * Parse a reply already in hand; when it is not valid structured output, issue the repair call
   * built from the raw reply and parse that instead. The parsed artifact is recorded either way.
   */
  async parseOrRepair<P>(
    host: T,
    received: { completion: ResearchCompletion; callId: string },
    schema: ZodType<P>,
    repair: (raw: string) => CallSpec,
    signal?: AbortSignal
  ): Promise<ParsedCall<P>> {
    let { completion, callId } = received;
    let parsed: P;
    try {
      parsed = parseStructuredOutput(completion.content, schema);
    } catch {
      const spec = repair(completion.content);
      callId = spec.id;
      completion = await this.invoke(host, spec, signal);
      parsed = parseStructuredOutput(completion.content, schema);
    }
    this.recordParsed(host, callId, parsed);
    return { parsed, completion, callId };
  }

  /** Invoke with blank retry, then parse with one repair attempt. */
  async parseWithRepair<P>(
    host: T,
    spec: CallSpec,
    schema: ZodType<P>,
    repair: (raw: string) => CallSpec,
    signal?: AbortSignal
  ): Promise<ParsedCall<P>> {
    const received = await this.invokeWithBlankRetry(host, spec, signal);
    return this.parseOrRepair(host, received, schema, repair, signal);
  }

  recordParsed(host: T, callId: string, value: unknown): void {
    const call = host.calls.find((item) => item.id === callId);
    if (!call) return;
    call.parsedPath = this.store.writeCallArtifact(
      host.id,
      call.stage,
      callId,
      'parsed',
      JSON.stringify(value, null, 2)
    );
    this.store.save(host);
  }

  private upsertCall(host: T, record: ProviderCallRecord): void {
    host.calls = [...host.calls.filter((call) => call.id !== record.id), record].sort(
      (left, right) => left.id.localeCompare(right.id)
    );
    this.store.save(host);
  }
}

export interface PreflightHost extends CallHost {
  providers: string[];
  unavailableProviders: string[];
}

export interface PreflightResult {
  providers: string[];
  unavailableProviders: string[];
}

/**
 * Check which requested providers are configured and answer a trivial prompt, in parallel. Sets
 * `providers` and `unavailableProviders` on the host and fails when fewer than `minProviders` are
 * usable. The caller sets and saves the host's stage before and after.
 */
export async function preflightProviders<T extends PreflightHost>(
  gateway: ResearchProviderGateway,
  store: SessionStoreBase<T>,
  host: T,
  requested: string[],
  minProviders: number,
  stage: ResearchProgress['stage'],
  progress?: ResearchProgressHandler,
  signal?: AbortSignal
): Promise<PreflightResult> {
  const workingDirectory = store.sessionDirectory(host.id);
  const known = new Set(
    (await gateway.listProviders(workingDirectory, signal)).map((provider) => provider.name)
  );
  let completed = 0;
  const results = await Promise.all(
    requested.map(async (provider) => {
      await emitProgress(progress, stage, completed, requested.length, `${provider}`, {
        subject: provider,
        event: 'started',
      });
      const healthy =
        known.has(provider) &&
        (await gateway.healthCheck(provider, workingDirectory, signal).catch(() => false));
      completed++;
      await emitProgress(
        progress,
        stage,
        completed,
        requested.length,
        `${provider}: ${healthy ? 'ready' : 'unavailable'}`,
        { subject: provider, event: 'finished' }
      );
      return { provider, healthy };
    })
  );
  host.providers = results.filter((result) => result.healthy).map((result) => result.provider);
  host.unavailableProviders = results
    .filter((result) => !result.healthy)
    .map((result) => result.provider);
  if (host.unavailableProviders.length > 0) {
    host.warnings.push(`Unavailable providers: ${host.unavailableProviders.join(', ')}`);
  }
  if (host.providers.length < minProviders) {
    throw new Error(
      `Preflight found ${host.providers.length} usable providers; ${minProviders} required`
    );
  }
  store.save(host);
  return { providers: host.providers, unavailableProviders: host.unavailableProviders };
}
