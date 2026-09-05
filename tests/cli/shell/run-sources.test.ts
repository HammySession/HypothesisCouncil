import { writeFileSync } from 'fs';
import { join } from 'path';
import { dispatchShellLine } from '../../../src/cli/shell/registry.js';
import {
  TEST_PROVIDERS,
  createTestContext,
  createTestStore,
  seedSession,
  type TestContext,
} from './fakes.js';

describe('/run with sources, scouts, and the web switch', () => {
  let ctx: TestContext;

  beforeEach(() => {
    const store = createTestStore();
    seedSession(store);
    ctx = createTestContext({
      store,
      providers: [
        ...TEST_PROVIDERS,
        { name: 'duck-c_scout', nickname: 'Duck Scout', model: 'model-c', type: 'cli' },
      ],
    });
    writeFileSync(join(ctx.cwd, 'README.md'), '# Demo\n\nSome context.\n');
    writeFileSync(
      join(ctx.cwd, 'sources.md'),
      '- https://example.org/a\n- https://example.org/b\n'
    );
  });

  it('previews supplied sources, the scouts that will search, and the sourcing calls', async () => {
    await dispatchShellLine(ctx, '/run "Explain the drift" --dry-run --sources sources.md');
    const errText = ctx.io.errLines.join('\n');
    expect(errText).toContain('Sources: 2 supplied from');
    expect(errText).toContain('sources.md');
    expect(errText).toContain('web scouts: duck-c_scout');
    expect(errText).toContain('verification: fetch; critique: on');
    expect(errText).toContain('reserved for the SOURCES appendix');
    expect(errText).toContain('2 sourcing');
    expect(errText).toContain('Providers: duck-a, duck-b');
    expect(ctx.clients.every((client) => client.asks.length === 0)).toBe(true);
  });

  it('switches scouting and fetching off with --web off and rejects other values', async () => {
    await dispatchShellLine(
      ctx,
      '/run "Explain the drift" --dry-run --sources sources.md --web off'
    );
    const errText = ctx.io.errLines.join('\n');
    expect(errText).toContain('web scouts: none');
    expect(errText).toContain('verification: none');
    expect(errText).toContain('Web: off (no scouting, no URL fetches).');
    await expect(dispatchShellLine(ctx, '/run goal --dry-run --web maybe')).rejects.toThrow(
      'sources.web must be one of auto, on, off'
    );
  });

  it('falls back to the settings file and environment for sources options', async () => {
    await dispatchShellLine(ctx, '/set sources.web off');
    await dispatchShellLine(ctx, '/set sources.file sources.md');
    ctx.io.errLines.length = 0;
    await dispatchShellLine(ctx, '/run "Explain the drift" --dry-run');
    let errText = ctx.io.errLines.join('\n');
    expect(errText).toContain('Sources: 2 supplied from');
    expect(errText).toContain('Web: off (no scouting, no URL fetches).');

    ctx.env.HYPOTHESIS_COUNCIL_WEB = 'on';
    ctx.io.errLines.length = 0;
    await dispatchShellLine(ctx, '/run "Explain the drift" --dry-run');
    errText = ctx.io.errLines.join('\n');
    expect(errText).toContain('web scouts: duck-c_scout');
    expect(errText).not.toContain('Web: off');
  });

  it('keeps scouts off the council and checks the scout list', async () => {
    await expect(
      dispatchShellLine(ctx, '/run goal --dry-run --providers duck-a,duck-c_scout')
    ).rejects.toThrow('Scout providers cannot sit on the council');
    await expect(dispatchShellLine(ctx, '/run goal --dry-run --scouts duck-z')).rejects.toThrow(
      'Unknown scout provider: duck-z'
    );
    await expect(
      dispatchShellLine(ctx, '/run goal --dry-run --sources missing.md')
    ).rejects.toThrow('Sources file not found');
  });
});
