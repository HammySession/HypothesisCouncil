import { createHash } from 'crypto';
import type { SourceVerificationMode } from './dials.js';
import type { SourceRecord, SourceVerificationRecord } from './sources.js';
import { VERSION } from '../version.js';

/**
 * Mechanical existence check for cited sources. A fetch proves that a URL resolves to something
 * with the expected title; it never proves the content is right. Only public http(s) hosts are
 * contacted, bodies are capped, and nothing from the fetched page is ever shown to a model.
 */
export interface SourceVerifier {
  verify(
    sources: SourceRecord[],
    options: { mode: SourceVerificationMode; signal?: AbortSignal }
  ): Promise<SourceRecord[]>;
}

export interface FetchSourceVerifierOptions {
  timeoutMs?: number;
  maxBytes?: number;
  concurrency?: number;
  maxRedirects?: number;
  now?: () => Date;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_REDIRECTS = 5;
const CROSSREF_API = 'https://api.crossref.org/works/';

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateIpv6(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (bare === '::1' || bare === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(bare)) return true; // fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(bare)) return true; // fe80::/10
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(bare);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
}

/** Loopback, link-local, private, and single-label hosts are never fetched. */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }
  if (host.startsWith('[') || host.includes(':')) return isPrivateIpv6(host);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPrivateIpv4(host);
  return !host.includes('.');
}

function resolveTarget(record: SourceRecord): string | undefined {
  if (record.url) return record.url;
  if (record.doi) return `https://doi.org/${record.doi}`;
  return undefined;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * True when the title (or most of its significant words) appears in the fetched text. Pages often
 * rewrap or truncate titles, so a 60% word overlap counts.
 */
export function titleAppears(title: string, body: string): boolean {
  const text = normalizeText(body.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' '));
  const wanted = normalizeText(title);
  if (!wanted) return false;
  if (text.includes(wanted)) return true;
  const words = wanted.split(' ').filter((word) => word.length >= 4);
  if (words.length === 0) return false;
  const found = words.filter((word) => text.includes(word)).length;
  return found / words.length >= 0.6;
}

async function readCapped(
  response: Response,
  maxBytes: number
): Promise<{ bytes: Buffer; truncated: boolean }> {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    return { bytes: buffer.subarray(0, maxBytes), truncated: buffer.byteLength > maxBytes };
  }
  const reader = body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const chunk = Buffer.from(value);
    if (total + chunk.byteLength > maxBytes) {
      chunks.push(chunk.subarray(0, maxBytes - total));
      total = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  return { bytes: Buffer.concat(chunks, total), truncated };
}

interface TimedSignal {
  signal: AbortSignal;
  /** Clears the timer; call once the response (headers and body) has been consumed. */
  dispose: () => void;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): TimedSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timed out')), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const dispose = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  };
  controller.signal.addEventListener('abort', dispose, { once: true });
  return { signal: controller.signal, dispose };
}

async function pooled<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await work(items[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

export function createFetchSourceVerifier(
  fetchImpl: FetchLike | undefined = globalThis.fetch as FetchLike | undefined,
  options: FetchSourceVerifierOptions = {}
): SourceVerifier {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const now = options.now ?? (() => new Date());
  const userAgent = `hypothesis-council/${VERSION} (source verification)`;

  const fetchOnce = async (
    target: string,
    signal: AbortSignal | undefined,
    accept: string
  ): Promise<
    | { response: Response; finalUrl: string; dispose: () => void }
    | { blocked: string }
    | { redirects: true }
  > => {
    if (!fetchImpl) throw new Error('fetch is not available in this runtime');
    let url = target;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { blocked: `invalid URL: ${url}` };
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { blocked: `unsupported scheme ${parsed.protocol}` };
      }
      if (isBlockedHost(parsed.hostname))
        return { blocked: `host not allowed: ${parsed.hostname}` };
      // The timer covers headers and body; the caller disposes it after reading the body.
      const timeout = withTimeout(signal, timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          redirect: 'manual',
          signal: timeout.signal,
          headers: { 'user-agent': userAgent, accept },
        });
      } catch (error) {
        timeout.dispose();
        throw error;
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return { response, finalUrl: url, dispose: timeout.dispose };
        timeout.dispose();
        url = new URL(location, url).toString();
        continue;
      }
      return { response, finalUrl: url, dispose: timeout.dispose };
    }
    return { redirects: true };
  };

  const checkRetraction = async (
    doi: string,
    signal: AbortSignal | undefined
  ): Promise<SourceVerificationRecord['retraction']> => {
    let outcome: Awaited<ReturnType<typeof fetchOnce>>;
    try {
      outcome = await fetchOnce(
        `${CROSSREF_API}${encodeURIComponent(doi)}`,
        signal,
        'application/json'
      );
    } catch {
      return { checked: false };
    }
    if (!('response' in outcome)) return { checked: false };
    try {
      if (!outcome.response.ok) return { checked: outcome.response.status === 404 };
      const { bytes } = await readCapped(outcome.response, maxBytes);
      const parsed = JSON.parse(bytes.toString('utf8')) as {
        message?: { 'update-to'?: Array<{ type?: string; label?: string; DOI?: string }> };
      };
      const updates = parsed.message?.['update-to'] ?? [];
      const retraction = updates.find((update) =>
        /retract/i.test(update.type ?? update.label ?? '')
      );
      return retraction
        ? {
            checked: true,
            notice: `${retraction.label ?? retraction.type ?? 'retraction'}${retraction.DOI ? ` (${retraction.DOI})` : ''}`,
          }
        : { checked: true };
    } catch {
      return { checked: false };
    } finally {
      outcome.dispose();
    }
  };

  const verifyOne = async (
    record: SourceRecord,
    mode: SourceVerificationMode,
    signal: AbortSignal | undefined
  ): Promise<SourceRecord> => {
    const checkedAt = now().toISOString();
    const target = resolveTarget(record);
    if (mode === 'none' || !target) {
      return { ...record, verification: { status: 'skipped', checkedAt } };
    }
    let verification: SourceVerificationRecord;
    try {
      const outcome = await fetchOnce(
        target,
        signal,
        'text/html, application/pdf;q=0.9, */*;q=0.5'
      );
      if ('blocked' in outcome) {
        verification = { status: 'blocked', checkedAt, error: outcome.blocked };
      } else if ('redirects' in outcome) {
        verification = { status: 'unreachable', checkedAt, error: 'too many redirects' };
      } else {
        const { response, finalUrl, dispose } = outcome;
        let bytes: Buffer;
        try {
          ({ bytes } = await readCapped(response, maxBytes));
        } finally {
          dispose();
        }
        const contentType = response.headers.get('content-type') ?? '';
        const textual =
          /^(text\/|application\/(json|xml|xhtml))/i.test(contentType) || contentType === '';
        verification = {
          status: response.ok ? 'reachable' : 'unreachable',
          checkedAt,
          httpStatus: response.status,
          finalUrl,
          contentSha256: createHash('sha256').update(bytes).digest('hex'),
        };
        if (response.ok && textual) {
          verification.titleFound = titleAppears(record.title, bytes.toString('utf8'));
        }
        if (!response.ok) verification.error = `HTTP ${response.status}`;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      verification = {
        status: 'unreachable',
        checkedAt,
        error: /abort|timed out/i.test(message) ? 'timed out' : message,
      };
    }
    if (mode === 'fetch-plus-retraction' && record.doi && verification.status !== 'blocked') {
      verification.retraction = await checkRetraction(record.doi, signal);
      if (verification.retraction?.notice) verification.status = 'retracted';
    }
    return { ...record, verification };
  };

  return {
    verify: (sources, { mode, signal }) =>
      pooled(sources, concurrency, (record) => verifyOne(record, mode, signal)),
  };
}

/** Marks every record as not fetched; used when the web is off and in tests. */
export const skippedVerifier: SourceVerifier = {
  verify: (sources) =>
    Promise.resolve(
      sources.map((record) => ({
        ...record,
        verification: { status: 'skipped' as const, checkedAt: new Date().toISOString() },
      }))
    ),
};
