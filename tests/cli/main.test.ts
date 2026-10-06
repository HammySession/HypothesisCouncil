import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { cliHelpText, executeCommand, reportError } from '../../src/cli/main.js';
import { createMemoryIO } from '../../src/cli/shell/io.js';
import { createFakeRunner, writeVendorHome } from './model-fixtures.js';
import { createTestContext, createTestStore, seedSession } from './shell/fakes.js';

describe('hc command line', () => {
  it('prints help and lists sessions as text and JSON without provider identities', async () => {
    const store = createTestStore();
    seedSession(store);
    const ctx = createTestContext({ store });

    expect(await executeCommand(['help'], store, ctx)).toBe(0);
    expect(ctx.io.text()).toContain('hc run "<goal>"');
    expect(ctx.io.text()).toContain('/run [goal] [flags]');
    expect(cliHelpText()).toContain('Interactive commands:');

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['sessions'], store, ctx)).toBe(0);
    expect(ctx.io.outLines).toEqual(['RC-20260827-000000Z-abc123  COMPLETE  Explain the drift']);

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['sessions', '--json'], store, ctx)).toBe(0);
    const listed = JSON.parse(ctx.io.text()) as Array<Record<string, unknown>>;
    expect(listed[0].id).toBe('RC-20260827-000000Z-abc123');
    expect(ctx.io.text()).not.toContain('authorProvider');
    expect(ctx.io.text()).not.toContain('reviewerProvider');
  });

  it('writes an HTML report to --out and opens it with --open', async () => {
    const store = createTestStore();
    seedSession(store);
    const ctx = createTestContext({ store });
    const outDir = mkdtempSync(join(tmpdir(), 'hc-out-'));

    expect(await executeCommand(['report', '--html', '--out', `${outDir}/`], store, ctx)).toBe(0);
    const expected = join(outDir, 'RC-20260827-000000Z-abc123.html');
    expect(ctx.io.outLines).toEqual([`HTML report: ${expected}`]);
    expect(readFileSync(expected, 'utf8')).toContain('<title>Hypothesis Council · RC-2026');
    expect(ctx.opened).toEqual([]);

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['report', '--open'], store, ctx)).toBe(0);
    const stored = join(store.sessionDirectory('RC-20260827-000000Z-abc123'), 'report.html');
    expect(existsSync(stored)).toBe(true);
    expect(ctx.opened).toEqual([stored]);

    await expect(executeCommand(['report', '--html', '--json'], store, ctx)).rejects.toThrow(
      '--html/--open cannot be combined with --json'
    );
  });

  it('copies reports, shows candidates, and hides reviewer identities in JSON', async () => {
    const store = createTestStore();
    seedSession(store);
    const ctx = createTestContext({ store });
    const outDir = mkdtempSync(join(tmpdir(), 'hc-out-'));

    expect(await executeCommand(['report', '--out', outDir, '--json'], store, ctx)).toBe(0);
    expect(ctx.io.outLines[0]).toBe(
      `Report copied to: ${join(outDir, 'RC-20260827-000000Z-abc123.json')}`
    );

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['show', '2', '--json'], store, ctx)).toBe(0);
    const shown = JSON.parse(ctx.io.text()) as { id: string; review?: Record<string, unknown> };
    expect(shown.id).toBe('H-002');
    expect(shown.review).toBeDefined();
    expect(ctx.io.text()).not.toContain('reviewerProvider');
    expect(ctx.io.text()).not.toContain('authorProvider');

    await expect(executeCommand(['show'], store, ctx)).rejects.toThrow('Usage: hc show H-001');
  });

  it('prints the version and accepts --help and -h', async () => {
    const store = createTestStore();
    const ctx = createTestContext({ store });
    expect(await executeCommand(['--version'], store, ctx)).toBe(0);
    expect(ctx.io.outLines).toEqual([expect.stringMatching(/^\d+\.\d+\.\d+/)]);
    const version = ctx.io.outLines[0];

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['--help'], store, ctx)).toBe(0);
    expect(ctx.io.outLines[0]).toBe(`Hypothesis Council ${version}`);
    expect(ctx.io.text()).toContain('Start here:');

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['-h'], store, ctx)).toBe(0);
    expect(ctx.io.text()).toContain('Start here:');
  });

  it('seats whichever supported CLIs are installed when nothing is configured', async () => {
    const store = createTestStore();
    const bare = createTestContext({ store, rubberDuckConfigured: false });
    expect(await executeCommand(['doctor'], store, bare)).toBe(1);
    expect(bare.clients).toEqual([]);
    expect(bare.io.text()).toContain('Preset: auto');
    expect(bare.io.text()).toContain('no providers are configured');
    expect(bare.io.text()).toContain('npm install -g @anthropic-ai/claude-code');

    await expect(executeCommand(['run', 'goal', '--dry-run'], store, bare)).rejects.toThrow(
      'No supported AI CLI was found on PATH'
    );

    const withClaude = createTestContext({
      store,
      rubberDuckConfigured: false,
      commandsOnPath: ['claude'],
      providers: [{ name: 'cli-claude', nickname: 'Claude', model: 'claude', type: 'cli' }],
    });
    writeFileSync(join(withClaude.cwd, 'README.md'), '# Demo\n');
    expect(await executeCommand(['run', 'goal', '--dry-run'], store, withClaude)).toBe(0);
    expect(withClaude.io.errLines).toContain('Preset: auto');
    expect(withClaude.env.CLI_CLAUDE_ENABLED).toBe('true');
    expect(withClaude.env.CLI_CODEX_ENABLED).toBeUndefined();

    withClaude.io.outLines.length = 0;
    expect(await executeCommand(['settings'], store, withClaude)).toBe(0);
    expect(withClaude.io.text()).toMatch(/preset\s+auto\s+default \(no provider configured\)/);

    withClaude.io.outLines.length = 0;
    expect(await executeCommand(['presets'], store, withClaude)).toBe(0);
    expect(withClaude.io.text()).toContain('auto');
    expect(withClaude.io.text()).toContain('whichever are installed');
  });

  it('returns a failing exit code when doctor finds problems', async () => {
    const store = createTestStore();
    const ctx = createTestContext({ store, providers: [] });
    expect(await executeCommand(['doctor'], store, ctx)).toBe(1);
    expect(ctx.io.text()).toContain('no providers are configured');

    ctx.io.outLines.length = 0;
    const healthy = createTestContext({ store });
    expect(await executeCommand(['doctor', '--json'], store, healthy)).toBe(0);
    expect((JSON.parse(healthy.io.text()) as { problems: string[] }).problems).toEqual([]);
  });

  it('lists the models a preset resolves to and serves repeats from the council cache', async () => {
    const store = createTestStore();
    const runner = createFakeRunner();
    const home = mkdtempSync(join(tmpdir(), 'hc-home-'));
    writeVendorHome(home);
    const ctx = createTestContext({
      store,
      commandsOnPath: ['agy', 'claude', 'codex', 'grok'],
      homeDirectory: home,
      runVendorCommand: runner.run,
    });

    expect(await executeCommand(['models'], store, ctx)).toBe(0);
    const text = ctx.io.text();
    expect(text).toContain('Models for preset frontier (policy: latest)');
    expect(text).toContain('gemini-3.8-flash-high');
    expect(text).toContain('auto: latest of 7');
    expect(text).toContain('grok-4.6');
    expect(text).toContain('gpt-5.4 (superseded by gpt-5.6-terra)');
    expect(text).toContain('gpt-reserve (hidden)');
    expect(text).not.toMatch(/FAKE|api_key|oauth/);
    // Codex, Grok, and Claude were answered from their own files; only AGY had to be asked.
    expect(runner.calls.map((call) => call.args.join(' '))).toEqual(['models']);

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['models', '--json', '--model', 'codex=gpt-5.5'], store, ctx)).toBe(
      0
    );
    const listed = JSON.parse(ctx.io.text()) as {
      policy: string;
      models: Record<string, { id: string; origin: string }>;
    };
    expect(listed.policy).toBe('latest');
    expect(listed.models.codex).toMatchObject({ id: 'gpt-5.5', origin: 'explicit' });
    expect(listed.models.agy).toMatchObject({ id: 'gemini-3.8-flash-high', origin: 'latest' });
    expect(runner.calls).toHaveLength(1);

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['models', '--refresh'], store, ctx)).toBe(0);
    expect(runner.calls.length).toBeGreaterThan(1);

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['models', '--model-policy', 'pinned'], store, ctx)).toBe(0);
    expect(ctx.io.text()).toContain('(policy: pinned)');
    expect(ctx.io.text()).toContain('gpt-6.1-sol');

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['models', '--preset', 'quick'], store, ctx)).toBe(0);
    expect(ctx.io.text()).toContain('Preset quick has no model slots');

    await expect(executeCommand(['models', '--model', 'nope'], store, ctx)).rejects.toThrow(
      '--model expects KEY=ID'
    );
  });

  it('prints the resolved models for a preset run and applies explicit pins', async () => {
    const store = createTestStore();
    const runner = createFakeRunner();
    const home = mkdtempSync(join(tmpdir(), 'hc-home-'));
    writeVendorHome(home);
    const ctx = createTestContext({
      store,
      commandsOnPath: ['agy', 'claude', 'codex', 'grok'],
      homeDirectory: home,
      runVendorCommand: runner.run,
    });
    writeFileSync(join(ctx.cwd, 'README.md'), '# Demo\n');

    expect(
      await executeCommand(
        [
          'run',
          'goal',
          '--dry-run',
          '--preset',
          'frontier',
          '--providers',
          'duck-a,duck-b',
          '--min-providers',
          '2',
          '--model',
          'codex=gpt-5.5',
        ],
        store,
        ctx
      )
    ).toBe(0);
    const err = ctx.io.errLines.join('\n');
    expect(err).toContain('Preset: frontier');
    expect(err).toContain(
      'Models: grok=grok-4.6 (auto: latest of 3) · agy=gemini-3.8-flash-high (auto: latest of 7) · claude=claude-fable-5-1[1m] (auto: latest of 2) · codex=gpt-5.5 (explicit)'
    );
    expect(ctx.env).toMatchObject({
      CLI_CODEX_DEFAULT_MODEL: 'gpt-5.5',
      CLI_CUSTOM_AGY_DEFAULT_MODEL: 'gemini-3.8-flash-high',
      CLI_CLAUDE_DEFAULT_MODEL: 'claude-fable-5-1[1m]',
      HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_GROK: '500000',
    });
    expect(ctx.env.HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_CODEX).toBeUndefined();
  });

  it('rejects unknown commands and prints hints for known failures', async () => {
    const store = createTestStore();
    const ctx = createTestContext({ store });
    await expect(executeCommand(['bogus'], store, ctx)).rejects.toThrow('Unknown command: bogus');

    const io = createMemoryIO();
    reportError(io, new Error('No current research session'));
    expect(io.errLines).toEqual([
      'Error: No current research session',
      'Hint: Run `hc run` to start a session, or `hc sessions` to list existing ones.',
    ]);
  });

  it('lists, opens, and tags reports from the command line', async () => {
    const store = createTestStore();
    seedSession(store);
    const ctx = createTestContext({ store });

    expect(await executeCommand(['reports'], store, ctx)).toBe(0);
    expect(ctx.io.text()).toMatch(
      /1\s+RC-20260827-000000Z-abc123\s+2026-08-27 00:00\s+COMPLETE\s+-\s+2\s+Explain the drift/
    );

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['reports', '--json', '--tag', 'drift'], store, ctx)).toBe(0);
    const listed = JSON.parse(ctx.io.text()) as Array<Record<string, unknown>>;
    expect(listed[0]).toMatchObject({
      index: 1,
      id: 'RC-20260827-000000Z-abc123',
      kind: 'research',
    });
    expect(ctx.io.text()).not.toContain('duck-a');
    expect(ctx.io.text()).not.toContain('authorProvider');

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['reports', '--html', '--open'], store, ctx)).toBe(0);
    const gallery = join(store.root, 'index.html');
    expect(ctx.opened).toEqual([gallery]);
    expect(ctx.io.outLines.at(-1)).toBe(`Gallery: ${gallery}`);
    expect(existsSync(gallery)).toBe(true);

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['open', '1'], store, ctx)).toBe(0);
    const htmlPath = join(store.sessionDirectory('RC-20260827-000000Z-abc123'), 'report.html');
    expect(ctx.opened).toEqual([gallery, htmlPath]);
    await expect(executeCommand(['open'], store, ctx)).rejects.toThrow('Usage: hc open');

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['tag', 'add', 'perf'], store, ctx)).toBe(0);
    expect(await executeCommand(['tag', 'RC-20260827-000000Z-abc123', 'show'], store, ctx)).toBe(0);
    expect(ctx.io.outLines).toEqual([
      'Tags for RC-20260827-000000Z-abc123: perf',
      'RC-20260827-000000Z-abc123: Explain the drift',
      'Tags: perf',
    ]);

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['settings', '--providers'], store, ctx)).toBe(0);
    expect(ctx.io.text()).toMatch(/preset\s+\(none\)\s+default/);
    expect(ctx.io.text()).toMatch(/provider\.duck-a\s+model-a \(cli\)\s+rubber duck/);
    expect(ctx.io.text()).not.toContain('shell.repo');
  });

  it('edits, lists, and resets settings from the command line', async () => {
    const store = createTestStore();
    const ctx = createTestContext({ store, env: { HYPOTHESIS_COUNCIL_SKEPTICISM: '7' } });
    const settingsFile = join(store.root, 'settings.json');

    expect(await executeCommand(['settings', 'set', 'novelty', 'high'], store, ctx)).toBe(0);
    expect(ctx.io.outLines[0]).toBe(`Set novelty = 8 in ${settingsFile}`);
    expect(ctx.io.errLines).toEqual([]);
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual({ version: 1, novelty: 8 });

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['settings', 'set', 'skepticism=low'], store, ctx)).toBe(0);
    expect(ctx.io.errLines).toEqual([
      'Warning: HYPOTHESIS_COUNCIL_SKEPTICISM=7 is set in the environment and takes precedence over the settings file.',
    ]);

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['settings'], store, ctx)).toBe(0);
    expect(ctx.io.text()).toMatch(/novelty\s+8\s+file/);
    expect(ctx.io.text()).toMatch(/skepticism\s+7\s+env HYPOTHESIS_COUNCIL_SKEPTICISM/);
    expect(ctx.io.text()).toContain(`Settings file: ${settingsFile}`);

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['settings', '--json'], store, ctx)).toBe(0);
    const json = JSON.parse(ctx.io.text()) as {
      values: Record<string, unknown>;
      origins: Record<string, string>;
      filePath: string;
    };
    expect(json.values).toMatchObject({ novelty: 8, skepticism: 7, modelPolicy: 'latest' });
    expect(json.origins).toMatchObject({
      novelty: 'file',
      skepticism: 'env',
      modelPolicy: 'default',
    });
    expect(json.filePath).toBe(settingsFile);

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['settings', 'path'], store, ctx)).toBe(0);
    expect(ctx.io.outLines).toEqual([settingsFile]);

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['settings', 'help'], store, ctx)).toBe(0);
    expect(ctx.io.text()).toContain('sources.web');

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['settings', 'unset', 'novelty'], store, ctx)).toBe(0);
    expect(ctx.io.outLines).toEqual([`Unset novelty in ${settingsFile}`]);
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual({ version: 1, skepticism: 2 });

    ctx.io.outLines.length = 0;
    expect(await executeCommand(['settings', 'reset'], store, ctx)).toBe(0);
    expect(ctx.io.outLines).toEqual([`Settings reset; removed ${settingsFile}`]);
    expect(existsSync(settingsFile)).toBe(false);
    ctx.io.outLines.length = 0;
    expect(await executeCommand(['settings', 'reset'], store, ctx)).toBe(0);
    expect(ctx.io.outLines).toEqual([`No settings file at ${settingsFile}`]);

    await expect(executeCommand(['settings', 'set', 'nope', '1'], store, ctx)).rejects.toThrow(
      'Unknown setting: nope'
    );
    await expect(executeCommand(['settings', 'set', 'novelty', '11'], store, ctx)).rejects.toThrow(
      'novelty must be an integer from 0 to 10'
    );
    await expect(executeCommand(['settings', 'set', 'novelty'], store, ctx)).rejects.toThrow(
      'Missing value for novelty'
    );
    await expect(executeCommand(['settings', 'frobnicate'], store, ctx)).rejects.toThrow(
      'Unknown settings command: frobnicate'
    );
  });
});
