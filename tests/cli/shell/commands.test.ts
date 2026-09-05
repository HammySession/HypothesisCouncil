import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { dispatchShellLine } from '../../../src/cli/shell/registry.js';
import { createFakeRunner, writeVendorHome } from '../model-fixtures.js';
import { createTestContext, createTestStore, seedSession, type TestContext } from './fakes.js';

describe('interactive shell commands', () => {
  let ctx: TestContext;

  beforeEach(() => {
    const store = createTestStore();
    seedSession(store);
    ctx = createTestContext({ store, commandsOnPath: ['claude', 'codex'] });
  });

  it('starts on the current session and shows status, candidates, and one candidate', async () => {
    expect(ctx.state.selectedSession).toBe('RC-20260827-000000Z-abc123');

    await dispatchShellLine(ctx, '/status');
    expect(ctx.io.text()).toContain('RC-20260827-000000Z-abc123  COMPLETE');
    expect(ctx.io.text()).toContain('Goal: Explain the drift');

    await dispatchShellLine(ctx, '/candidates');
    expect(ctx.io.text()).toContain('1.   H-002  Title H-002  [review 7.50 · accept · novelty 7]');

    await dispatchShellLine(ctx, '/show 1');
    expect(ctx.io.text()).toContain('H-001 — Title H-001');
    expect(ctx.io.text()).not.toContain('duck-b');
    await expect(dispatchShellLine(ctx, '/show')).rejects.toThrow('Usage: /show H-001');
  });

  it('lists and selects sessions', async () => {
    seedSession(ctx.store, { id: 'RC-20260828-000000Z-def456', goal: 'Second goal' });
    await dispatchShellLine(ctx, '/sessions');
    expect(ctx.io.outLines).toEqual([
      'RC-20260828-000000Z-def456  COMPLETE  Second goal',
      'RC-20260827-000000Z-abc123  COMPLETE  Explain the drift',
    ]);

    ctx.state.chats.set('duck-a', [{ role: 'user', text: 'earlier' }]);
    await dispatchShellLine(ctx, '/use RC-20260827-000000Z-abc123');
    expect(ctx.state.selectedSession).toBe('RC-20260827-000000Z-abc123');
    expect(ctx.store.currentId()).toBe('RC-20260827-000000Z-abc123');
    expect(ctx.state.chats.size).toBe(0);
    expect(ctx.io.outLines.at(-1)).toBe('Using RC-20260827-000000Z-abc123');

    await expect(dispatchShellLine(ctx, '/use RC-missing')).rejects.toThrow(
      'Research session not found: RC-missing'
    );
  });

  it('selects the conversational duck and resets its history', async () => {
    ctx.state.chats.set('duck-b', [{ role: 'user', text: 'earlier' }]);
    await dispatchShellLine(ctx, '/duck duck-b');
    expect(ctx.state.selection).toEqual({ kind: 'named', names: ['duck-b'] });
    expect(ctx.state.chats.has('duck-b')).toBe(false);
    expect(ctx.io.outLines).toEqual(['Conversational ducks: duck-b']);
  });

  it('applies a preset into the shell environment when its commands exist', async () => {
    await dispatchShellLine(ctx, '/preset quick');
    expect(ctx.state.preset?.name).toBe('quick');
    expect(ctx.env.CLI_CLAUDE_ENABLED).toBe('true');
    expect(ctx.env.CLI_CODEX_ENABLED).toBe('true');
    expect(ctx.io.outLines).toEqual(['Preset quick: cli-claude, cli-codex']);

    await expect(dispatchShellLine(ctx, '/preset frontier')).rejects.toThrow(
      'Preset frontier needs these commands on PATH: agy, grok'
    );
    await expect(dispatchShellLine(ctx, '/preset')).rejects.toThrow('Usage: /preset NAME');
  });

  it('resolves preset models in /preset and lists them with /models', async () => {
    const runner = createFakeRunner();
    const home = mkdtempSync(join(tmpdir(), 'hc-home-'));
    writeVendorHome(home);
    const shell = createTestContext({
      store: ctx.store,
      commandsOnPath: ['agy', 'claude', 'codex', 'grok'],
      homeDirectory: home,
      runVendorCommand: runner.run,
    });

    await dispatchShellLine(shell, '/preset frontier');
    expect(shell.io.outLines).toEqual([
      'Preset frontier: cli-grok, cli-agy, cli-claude, cli-codex · models: grok=grok-4.6 (auto: latest of 3) · agy=gemini-3.8-flash-high (auto: latest of 7) · claude=claude-fable-5-1[1m] (auto: latest of 2) · codex=gpt-5.6-sol (auto: latest of 9)',
    ]);
    expect(shell.env.CLI_CODEX_DEFAULT_MODEL).toBe('gpt-5.6-sol');
    expect(shell.env.HYPOTHESIS_COUNCIL_CONTEXT_TOKENS_CLI_CODEX).toBe('272000');
    expect(shell.env.CLI_CUSTOM_GROK_CLI_ARGS).toContain('grok,-m,grok-4.6,');

    shell.io.outLines.length = 0;
    await dispatchShellLine(shell, '/models');
    expect(shell.io.text()).toContain('Models for preset frontier (policy: latest)');
    expect(shell.io.text()).toContain('hc-cache');

    const before = runner.calls.length;
    await dispatchShellLine(shell, '/models refresh');
    expect(runner.calls.length).toBeGreaterThan(before);
  });

  it('prints the report and opens the HTML rendering through the injected opener', async () => {
    await dispatchShellLine(ctx, '/report');
    expect(ctx.io.text()).toContain('# Hypothesis Council report');

    await dispatchShellLine(ctx, '/report html');
    const htmlPath = join(ctx.store.sessionDirectory(ctx.state.selectedSession!), 'report.html');
    expect(ctx.opened).toEqual([htmlPath]);
    expect(ctx.io.outLines.at(-1)).toBe(`HTML report: ${htmlPath}`);
    expect(readFileSync(htmlPath, 'utf8')).toContain('<h1>Hypothesis Council report</h1>');

    await expect(dispatchShellLine(ctx, '/report pdf')).rejects.toThrow('Usage: /report [html]');
  });

  it('lists, opens, tags, and summarises reports from the shell', async () => {
    await dispatchShellLine(ctx, '/reports');
    expect(ctx.io.text()).toMatch(
      /1\s+RC-20260827-000000Z-abc123\s+2026-08-27 00:00\s+COMPLETE\s+—\s+2\s+Explain the drift\s+drift, title/
    );
    expect(ctx.io.outLines.at(-1)).toBe(
      'Open one with /open N (or /open index for the gallery); tag with /tag.'
    );
    expect(ctx.state.lastReportListing).toEqual(['RC-20260827-000000Z-abc123']);
    expect(ctx.io.text()).not.toContain('duck-a');

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/open 1');
    const htmlPath = join(ctx.store.sessionDirectory('RC-20260827-000000Z-abc123'), 'report.html');
    expect(ctx.opened).toEqual([htmlPath]);
    expect(ctx.io.outLines).toEqual([`HTML report: ${htmlPath}`]);

    await dispatchShellLine(ctx, '/open index');
    const gallery = join(ctx.store.root, 'index.html');
    expect(ctx.opened).toEqual([htmlPath, gallery]);
    expect(readFileSync(gallery, 'utf8')).toContain('Explain the drift');
    await expect(dispatchShellLine(ctx, '/open 4')).rejects.toThrow('No report is listed as #4');

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/tag add Perf, drift');
    await dispatchShellLine(ctx, '/tag title "Scheduler drift"');
    await dispatchShellLine(ctx, '/tag RC-20260827-000000Z-abc123 rm perf');
    await dispatchShellLine(ctx, '/tag');
    expect(ctx.io.outLines).toEqual([
      'Tags for RC-20260827-000000Z-abc123: perf, drift',
      'Title for RC-20260827-000000Z-abc123: Scheduler drift',
      'Tags for RC-20260827-000000Z-abc123: drift',
      'RC-20260827-000000Z-abc123: Scheduler drift',
      'Tags: drift',
    ]);
    expect(ctx.store.load('RC-20260827-000000Z-abc123').meta).toEqual({
      title: 'Scheduler drift',
      tags: ['drift'],
    });
    await expect(dispatchShellLine(ctx, '/tag bogus')).rejects.toThrow('Unknown verb: bogus');

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/reports --tag perf');
    expect(ctx.io.outLines).toEqual(['No reports yet. Run /run to start a council session.']);

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/reports --json scheduler');
    const listed = JSON.parse(ctx.io.text()) as Array<Record<string, unknown>>;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ title: 'Scheduler drift', userTags: ['drift'] });
    expect(ctx.io.text()).not.toContain('authorProvider');
  });

  it('saves a duck-written summary with /summarize', async () => {
    const store = ctx.store;
    ctx = createTestContext({
      store,
      replies: [
        { promptStartsWith: 'report-summary:v1', content: '  H-002 explains  the drift.  ' },
      ],
    });
    await dispatchShellLine(ctx, '/summarize');
    expect(ctx.io.outLines).toEqual(['H-002 explains the drift.']);
    expect(ctx.store.load('RC-20260827-000000Z-abc123').meta?.summary).toBe(
      'H-002 explains the drift.'
    );
    const prompt = ctx.clients[0].asks[0].prompt;
    expect(prompt).toContain('Title H-002');
    expect(prompt).not.toContain('authorProvider');
    expect(prompt).not.toContain('reviewerProvider');
    expect(ctx.clients[0].workingDirectory).toBe(
      ctx.store.sessionDirectory('RC-20260827-000000Z-abc123')
    );
  });

  it('shows shell state, preset models, and providers in /settings', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hc-home-'));
    writeVendorHome(home);
    ctx = createTestContext({
      store: ctx.store,
      commandsOnPath: ['agy', 'claude', 'codex', 'grok'],
      homeDirectory: home,
      runVendorCommand: createFakeRunner().run,
    });
    await dispatchShellLine(ctx, '/settings');
    expect(ctx.io.text()).toMatch(/preset\s+\(none\)\s+default/);
    expect(ctx.io.text()).toMatch(/shell\.session\s+RC-20260827-000000Z-abc123\s+shell \(\/use\)/);
    expect(ctx.io.text()).toMatch(/shell\.ducks\s+auto\s+shell \(\/duck\)/);
    expect(ctx.io.text()).toMatch(/shell\.context\s+\(empty\)\s+shell \(\/context\)/);
    expect(ctx.io.text()).not.toContain('provider.duck-a');

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/preset frontier');
    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/settings providers');
    expect(ctx.io.text()).toMatch(/preset\s+frontier\s+shell \(\/preset\)/);
    expect(ctx.io.text()).toMatch(
      /model\.codex\s+gpt-5\.6-sol \(272k tokens\)\s+auto: latest of 9/
    );
    expect(ctx.io.text()).toMatch(/provider\.duck-a\s+model-a \(cli\)\s+rubber duck/);

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/settings json');
    const json = JSON.parse(ctx.io.text()) as Record<string, unknown>;
    expect(json.preset).toEqual({ value: 'frontier', origin: 'shell (/preset)' });
    expect(json.shell).toMatchObject({ ducks: { value: 'auto' } });
    await expect(dispatchShellLine(ctx, '/settings bogus')).rejects.toThrow('Usage: /settings');
  });

  it('marks the shell as closing on /exit and /quit', async () => {
    await dispatchShellLine(ctx, '/exit');
    expect(ctx.state.closing).toBe(true);
    ctx.state.closing = false;
    await dispatchShellLine(ctx, '/quit');
    expect(ctx.state.closing).toBe(true);
  });

  it('lists commands with /help', async () => {
    await dispatchShellLine(ctx, '/help');
    expect(ctx.io.text()).toContain('Interactive commands:');
    expect(ctx.io.text()).toContain('/preset NAME');
    expect(ctx.io.text()).not.toContain('hc doctor');
  });

  it('runs a dry-run preview through /run with quoted goals and flags', async () => {
    writeFileSync(join(ctx.cwd, 'README.md'), '# Demo\n\nSome context.\n');
    await dispatchShellLine(ctx, '/run "Explain the drift" --dry-run --markdown-only');

    const errText = ctx.io.errLines.join('\n');
    expect(errText).toContain('Goal: Explain the drift');
    expect(errText).toContain('Context mode: Markdown files only');
    expect(errText).toContain('Dry run: no session was created');
    expect(ctx.clients.every((client) => client.asks.length === 0)).toBe(true);
    expect(ctx.clients.every((client) => client.closes === 1)).toBe(true);
    expect(ctx.state.selectedSession).toBe('RC-20260827-000000Z-abc123');
  });

  it('rejects a repository that does not exist', async () => {
    await expect(dispatchShellLine(ctx, '/run goal --repo missing-dir --dry-run')).rejects.toThrow(
      'Repository directory not found'
    );
  });

  it('runs doctor against the fake gateway', async () => {
    await dispatchShellLine(ctx, '/doctor');
    expect(ctx.io.text()).toContain('Hypothesis Council doctor');
    expect(ctx.io.text()).toContain('duck-a');
    expect(ctx.io.text()).toContain('mcp-rubber-duck 1.20.5');
  });

  it('answers plain text with a session-grounded ask and keeps per-duck history', async () => {
    const store = ctx.store;
    ctx = createTestContext({
      store,
      replies: [
        { promptStartsWith: 'session-grounded-ask', content: 'Grounded answer.' },
        { content: 'Free answer.' },
      ],
    });

    await dispatchShellLine(ctx, 'Which candidate wins?');
    expect(ctx.io.outLines).toEqual(['Grounded answer.']);
    expect(ctx.clients).toHaveLength(1);
    expect(ctx.clients[0].asks[0].provider).toBe('duck-a');
    expect(ctx.clients[0].workingDirectory).toBe(
      store.sessionDirectory(ctx.state.selectedSession!)
    );
    expect(ctx.state.chats.get('duck-a')).toEqual([
      { role: 'user', text: 'Which candidate wins?' },
      { role: 'duck', text: 'Grounded answer.' },
    ]);

    await dispatchShellLine(ctx, 'And why?');
    expect(ctx.clients[1].asks[0].prompt).toContain('Duck: Grounded answer.');
  });

  it('chats with the first CLI duck when no session is selected', async () => {
    ctx = createTestContext({ replies: [{ provider: 'duck-a', content: 'Hello from A.' }] });
    expect(ctx.state.selectedSession).toBeUndefined();

    await dispatchShellLine(ctx, 'hello');
    expect(ctx.io.outLines).toEqual(['Hello from A.']);
    expect(ctx.state.selection).toEqual({ kind: 'named', names: ['duck-a'] });
    expect(ctx.clients[0].asks[0]).toMatchObject({
      provider: 'duck-a',
      prompt: 'User: hello',
      workingDirectory: ctx.store.sessionDirectory('chat'),
    });
    expect(existsSync(ctx.store.sessionDirectory('chat'))).toBe(true);

    await dispatchShellLine(ctx, 'again');
    expect(ctx.clients[1].asks[0].prompt).toBe('User: hello\nDuck: Hello from A.\nUser: again');
  });

  it('saves settings with /set, warns when the environment shadows them, and refreshes the dials', async () => {
    ctx.env.HYPOTHESIS_COUNCIL_SKEPTICISM = '9';
    await dispatchShellLine(ctx, '/set novelty high');
    expect(ctx.io.outLines.at(-1)).toMatch(/^Set novelty = 8 in /);
    expect(ctx.io.errLines).toEqual([]);
    expect(ctx.state.dials).toMatchObject({ novelty: 8, skepticism: 9 });

    await dispatchShellLine(ctx, '/set skepticism 2');
    expect(ctx.io.errLines).toEqual([
      'Warning: HYPOTHESIS_COUNCIL_SKEPTICISM=9 is set in the environment and takes precedence over the settings file.',
    ]);
    expect(ctx.state.dials).toMatchObject({ novelty: 8, skepticism: 9 });

    ctx.io.outLines.length = 0;
    await dispatchShellLine(ctx, '/settings');
    expect(ctx.io.text()).toMatch(/novelty\s+8\s+file/);
    expect(ctx.io.text()).toMatch(/skepticism\s+9\s+env HYPOTHESIS_COUNCIL_SKEPTICISM/);

    await dispatchShellLine(ctx, '/unset novelty');
    expect(ctx.state.dials).toMatchObject({ novelty: 5, skepticism: 9 });
    await expect(dispatchShellLine(ctx, '/set')).rejects.toThrow('Usage: /set KEY VALUE');
    await expect(dispatchShellLine(ctx, '/unset')).rejects.toThrow('Usage: /unset KEY');
    await expect(dispatchShellLine(ctx, '/settings nope')).rejects.toThrow('Usage: /settings');
  });

  it('shows dial origins and the extra planned calls in a dry-run preview', async () => {
    writeFileSync(join(ctx.cwd, 'README.md'), '# Demo\n\nSome context.\n');
    await dispatchShellLine(ctx, '/set skepticism 8');
    await dispatchShellLine(ctx, '/run "Explain the drift" --dry-run --novelty 9');

    const errText = ctx.io.errLines.join('\n');
    expect(errText).toContain('Dials: novelty 9/10 (flag) · skepticism 8/10 (file)');
    expect(errText).toContain('out-of-the-box');
    expect(errText).toContain('over 2 rounds');
    await expect(dispatchShellLine(ctx, '/run goal --dry-run --novelty')).rejects.toThrow(
      '--novelty requires 0-10 or low, medium, high'
    );
  });
});
