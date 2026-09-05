import {
  createFetchSourceVerifier,
  isBlockedHost,
  skippedVerifier,
  titleAppears,
} from '../../src/research/source-verify.js';
import type { SourceRecord } from '../../src/research/sources.js';

interface FakeResponseInit {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  delayMs?: number;
}

function fakeResponse(init: FakeResponseInit): Response {
  const headers = new Headers(init.headers ?? {});
  const body = init.body === undefined ? undefined : init.body;
  return new Response(body, { status: init.status ?? 200, headers });
}

type Route = FakeResponseInit | ((url: string, init: RequestInit) => Promise<Response>);

function fakeFetch(routes: Record<string, Route>, calls: string[] = []) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    calls.push(url);
    const route = routes[url];
    if (!route) return fakeResponse({ status: 404, body: 'missing' });
    if (typeof route === 'function') return route(url, init);
    if (route.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, route.delayMs);
        init.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('The operation was aborted'));
        });
      });
    }
    return fakeResponse(route);
  };
}

function record(id: string, overrides: Partial<SourceRecord> = {}): SourceRecord {
  return { id, title: `Title ${id}`, origin: 'scout', kind: 'paper', ...overrides };
}

describe('isBlockedHost', () => {
  it('blocks loopback, private, link-local, and single-label hosts', () => {
    for (const host of [
      'localhost',
      'api.localhost',
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.9',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '100.64.0.1',
      '::1',
      '[::1]',
      'fc00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      'intranet',
      'printer.local',
    ]) {
      expect(isBlockedHost(host)).toBe(true);
    }
    for (const host of ['example.org', '8.8.8.8', '172.32.0.1', 'arxiv.org', '2606:4700::1']) {
      expect(isBlockedHost(host)).toBe(false);
    }
  });
});

describe('titleAppears', () => {
  it('matches exact and partial titles in HTML', () => {
    const body = '<html><title>Latency   Spikes at Market Open</title><p>&nbsp;body</p></html>';
    expect(titleAppears('latency spikes at market open', body)).toBe(true);
    expect(titleAppears('Latency spikes at market open: a survey', body)).toBe(true);
    expect(titleAppears('Completely unrelated heading', body)).toBe(false);
    expect(titleAppears('', body)).toBe(false);
  });
});

describe('createFetchSourceVerifier', () => {
  const now = () => new Date('2026-09-04T00:00:00Z');

  it('fetches URLs, follows redirects, hashes bodies, and reports failures', async () => {
    const calls: string[] = [];
    const verifier = createFetchSourceVerifier(
      fakeFetch(
        {
          'https://example.org/ok': {
            headers: { 'content-type': 'text/html' },
            body: '<h1>Title S-001</h1>',
          },
          'https://example.org/moved': {
            status: 301,
            headers: { location: '/final' },
          },
          'https://example.org/final': {
            headers: { 'content-type': 'text/html' },
            body: '<h1>Other heading</h1>',
          },
          'https://example.org/gone': { status: 404, body: 'nope' },
          'https://example.org/slow': { delayMs: 500, body: 'late' },
          'https://example.org/pdf': {
            headers: { 'content-type': 'application/pdf' },
            body: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
          },
          'https://example.org/loop': {
            status: 302,
            headers: { location: 'https://example.org/loop' },
          },
          'https://doi.org/10.1000/paper': {
            headers: { 'content-type': 'text/html' },
            body: '<h1>Title S-007</h1>',
          },
        },
        calls
      ),
      { timeoutMs: 50, now, concurrency: 2, maxRedirects: 3 }
    );

    const results = await verifier.verify(
      [
        record('S-001', { url: 'https://example.org/ok' }),
        record('S-002', { url: 'https://example.org/moved' }),
        record('S-003', { url: 'https://example.org/gone' }),
        record('S-004', { url: 'https://example.org/slow' }),
        record('S-005', { url: 'https://example.org/pdf' }),
        record('S-006', { url: 'https://example.org/loop' }),
        record('S-007', { doi: '10.1000/paper' }),
        record('S-008'),
        record('S-009', { url: 'http://127.0.0.1:8080/secret' }),
        record('S-010', { url: 'file:///etc/passwd' }),
      ],
      { mode: 'fetch' }
    );

    const byId = Object.fromEntries(results.map((item) => [item.id, item.verification]));
    expect(byId['S-001']).toEqual({
      status: 'reachable',
      checkedAt: '2026-09-04T00:00:00.000Z',
      httpStatus: 200,
      finalUrl: 'https://example.org/ok',
      contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      titleFound: true,
    });
    expect(byId['S-002']).toMatchObject({
      status: 'reachable',
      finalUrl: 'https://example.org/final',
      titleFound: false,
    });
    expect(byId['S-003']).toMatchObject({
      status: 'unreachable',
      httpStatus: 404,
      error: 'HTTP 404',
    });
    expect(byId['S-004']).toMatchObject({ status: 'unreachable', error: 'timed out' });
    expect(byId['S-005']).toMatchObject({ status: 'reachable', httpStatus: 200 });
    expect(byId['S-005']?.titleFound).toBeUndefined();
    expect(byId['S-006']).toMatchObject({ status: 'unreachable', error: 'too many redirects' });
    expect(byId['S-007']).toMatchObject({
      status: 'reachable',
      finalUrl: 'https://doi.org/10.1000/paper',
    });
    expect(byId['S-008']).toEqual({ status: 'skipped', checkedAt: '2026-09-04T00:00:00.000Z' });
    expect(byId['S-009']).toMatchObject({
      status: 'blocked',
      error: 'host not allowed: 127.0.0.1',
    });
    expect(byId['S-010']).toMatchObject({ status: 'blocked', error: 'unsupported scheme file:' });
    expect(calls).not.toContain('http://127.0.0.1:8080/secret');
    expect(calls).not.toContain('file:///etc/passwd');
    expect(byId['S-007']?.retraction).toBeUndefined();
  });

  it('caps the bytes it reads and hashes only the capped prefix', async () => {
    const verifier = createFetchSourceVerifier(
      fakeFetch({
        'https://example.org/big': {
          headers: { 'content-type': 'text/plain' },
          body: 'x'.repeat(5000),
        },
      }),
      { maxBytes: 100, now }
    );
    const [result] = await verifier.verify([record('S-001', { url: 'https://example.org/big' })], {
      mode: 'fetch',
    });
    const { createHash } = await import('crypto');
    expect(result.verification?.contentSha256).toBe(
      createHash('sha256').update('x'.repeat(100)).digest('hex')
    );
  });

  it('refuses to follow a redirect into a private network', async () => {
    const calls: string[] = [];
    const verifier = createFetchSourceVerifier(
      fakeFetch(
        {
          'https://example.org/bounce': {
            status: 302,
            headers: { location: 'http://169.254.169.254/latest/meta-data' },
          },
        },
        calls
      ),
      { now }
    );
    const [result] = await verifier.verify(
      [record('S-001', { url: 'https://example.org/bounce' })],
      {
        mode: 'fetch',
      }
    );
    expect(result.verification).toMatchObject({
      status: 'blocked',
      error: 'host not allowed: 169.254.169.254',
    });
    expect(calls).toEqual(['https://example.org/bounce']);
  });

  it('checks Crossref for retractions only in fetch-plus-retraction mode', async () => {
    const calls: string[] = [];
    const routes: Record<string, Route> = {
      'https://doi.org/10.1000/retracted': {
        headers: { 'content-type': 'text/html' },
        body: '<h1>Title S-001</h1>',
      },
      'https://doi.org/10.1000/fine': {
        headers: { 'content-type': 'text/html' },
        body: '<h1>Title S-002</h1>',
      },
      'https://api.crossref.org/works/10.1000%2Fretracted': {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            'update-to': [{ type: 'retraction', label: 'Retraction', DOI: '10.1000/notice' }],
          },
        }),
      },
      'https://api.crossref.org/works/10.1000%2Ffine': {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: { title: ['Fine'] } }),
      },
    };
    const verifier = createFetchSourceVerifier(fakeFetch(routes, calls), { now });
    const records = [
      record('S-001', { doi: '10.1000/retracted' }),
      record('S-002', { doi: '10.1000/fine' }),
      record('S-003', { url: 'https://example.org/none' }),
    ];

    const plain = await verifier.verify(records, { mode: 'fetch' });
    expect(plain.map((item) => item.verification?.status)).toEqual([
      'reachable',
      'reachable',
      'unreachable',
    ]);
    expect(calls.some((url) => url.includes('crossref'))).toBe(false);

    const strict = await verifier.verify(records, { mode: 'fetch-plus-retraction' });
    expect(strict[0].verification).toMatchObject({
      status: 'retracted',
      retraction: { checked: true, notice: 'Retraction (10.1000/notice)' },
    });
    expect(strict[1].verification).toMatchObject({
      status: 'reachable',
      retraction: { checked: true },
    });
    expect(strict[2].verification?.retraction).toBeUndefined();
  });

  it('skips everything in mode none and with the skipped verifier', async () => {
    const calls: string[] = [];
    const verifier = createFetchSourceVerifier(fakeFetch({}, calls), { now });
    const records = [record('S-001', { url: 'https://example.org/a' })];
    const none = await verifier.verify(records, { mode: 'none' });
    expect(none[0].verification).toEqual({
      status: 'skipped',
      checkedAt: '2026-09-04T00:00:00.000Z',
    });
    expect(calls).toEqual([]);
    const skipped = await skippedVerifier.verify(records, { mode: 'fetch' });
    expect(skipped[0].verification?.status).toBe('skipped');
  });

  it('propagates cancellation', async () => {
    const controller = new AbortController();
    const verifier = createFetchSourceVerifier(
      fakeFetch({ 'https://example.org/slow': { delayMs: 1000, body: 'late' } }),
      { now, timeoutMs: 5000 }
    );
    const pending = verifier.verify([record('S-001', { url: 'https://example.org/slow' })], {
      mode: 'fetch',
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
