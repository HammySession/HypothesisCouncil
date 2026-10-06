import { writeFileSync } from 'fs';
import { join } from 'path';
import { CONTEXT_CONFIRMATION_REQUIRED, replyText } from '../../../src/cli/shell/chat.js';
import { dispatchShellLine } from '../../../src/cli/shell/registry.js';
import { createTestContext, createTestStore, seedSession, type TestContext } from './fakes.js';

describe('shell chat', () => {
  it('labels replies from several ducks and keeps going when one fails', async () => {
    const ctx = createTestContext({
      replies: [
        { provider: 'duck-a', content: 'A says hi.' },
        { provider: 'duck-b', error: new Error('boom') },
      ],
    });
    await dispatchShellLine(ctx, '/duck all');
    expect(ctx.state.selection).toEqual({ kind: 'all' });
    expect(ctx.io.outLines).toEqual(['Conversational ducks: all']);
    ctx.io.outLines.length = 0;

    await dispatchShellLine(ctx, 'hello everyone');
    expect(ctx.io.text()).toBe(
      ['[duck-a · model-a · 0s]', 'A says hi.', '', '[duck-b · 0s]', 'error: boom'].join('\n')
    );
    expect(ctx.clients[0].asks.map((ask) => ask.provider).sort()).toEqual(['duck-a', 'duck-b']);
    expect(ctx.state.chats.get('duck-a')).toHaveLength(2);
    expect(ctx.state.chats.get('duck-b')).toEqual([]);
    expect(ctx.state.selection).toEqual({ kind: 'all' });
  });

  it('fails only when every duck fails', async () => {
    const ctx = createTestContext({ replies: [{ error: new Error('offline') }] });
    await dispatchShellLine(ctx, '/duck duck-a,duck-b');
    await expect(dispatchShellLine(ctx, 'anyone?')).rejects.toThrow(
      'duck-a: offline\nduck-b: offline'
    );
  });

  it('routes an @duck mention for one message without changing the selection', async () => {
    const store = createTestStore();
    seedSession(store);
    const ctx = createTestContext({
      store,
      replies: [{ promptStartsWith: 'session-grounded-ask', content: 'B answers.' }],
    });

    await dispatchShellLine(ctx, '@duck-b which candidate wins?');
    expect(ctx.io.outLines).toEqual(['B answers.']);
    expect(ctx.clients[0].asks[0].provider).toBe('duck-b');
    expect(ctx.clients[0].asks[0].prompt).toContain('USER QUESTION\nwhich candidate wins?');
    expect(ctx.state.selection).toEqual({ kind: 'auto' });
    await expect(dispatchShellLine(ctx, '@duck-b')).rejects.toThrow('Nothing to ask');
  });

  it('asks every session duck once with /ask-all and restores the selection', async () => {
    const store = createTestStore();
    seedSession(store);
    const ctx = createTestContext({
      store,
      replies: [
        { provider: 'duck-a', content: 'A: H-002.' },
        { provider: 'duck-b', content: 'B: H-001.' },
      ],
    });
    await dispatchShellLine(ctx, '/duck duck-a');
    await dispatchShellLine(ctx, '/ask-all Which candidate wins?');
    expect(ctx.io.text()).toContain('[duck-a · 0s]\nA: H-002.');
    expect(ctx.io.text()).toContain('[duck-b · 0s]\nB: H-001.');
    expect(ctx.state.selection).toEqual({ kind: 'named', names: ['duck-a'] });
    await expect(dispatchShellLine(ctx, '/ask-all')).rejects.toThrow('Usage: /ask-all QUESTION');
  });

  it('forgets histories with /clear', async () => {
    const ctx = createTestContext();
    ctx.state.chats.set('duck-a', [{ role: 'user', text: 'x' }]);
    ctx.state.chats.set('duck-b', [{ role: 'user', text: 'y' }]);
    await dispatchShellLine(ctx, '/clear duck-a');
    expect([...ctx.state.chats.keys()]).toEqual(['duck-b']);
    await dispatchShellLine(ctx, '/clear');
    expect(ctx.state.chats.size).toBe(0);
    expect(ctx.io.outLines).toEqual([
      'Cleared the chat history of duck-a',
      'Cleared all chat histories',
    ]);
  });

  describe('with a context basket', () => {
    let ctx: TestContext;

    beforeEach(() => {
      ctx = createTestContext({
        replies: [{ provider: 'duck-a', content: 'Read it.' }],
        io: { confirms: [true] },
      });
      writeFileSync(join(ctx.cwd, 'notes.md'), '# Notes\n\nRemember the drift.\n');
    });

    it('previews the packet, asks once per packet, and sends it with the chat prompt', async () => {
      await dispatchShellLine(ctx, '/context add notes.md');
      expect(ctx.io.outLines).toEqual(['Added: notes.md']);

      await dispatchShellLine(ctx, 'what do the notes say?');
      expect(ctx.io.questions).toEqual(['Send this context with your message?']);
      expect(ctx.io.errLines[0]).toMatch(/^Context basket: 1 file, /);
      expect(ctx.io.errLines).toContain('  + notes.md');
      const prompt = ctx.clients[0].asks[0].prompt;
      expect(prompt).toMatch(/^CONTEXT \(provided by the user; answer from it where relevant\)\n/);
      expect(prompt).toContain('Remember the drift.');
      expect(prompt).toMatch(/\n\nUser: what do the notes say\?$/);

      await dispatchShellLine(ctx, 'and again?');
      expect(ctx.io.questions).toHaveLength(1);
      expect(ctx.clients[1].asks[0].prompt).toContain('Duck: Read it.');
    });

    it('adds @path mentions to the basket and refuses to send unconfirmed context', async () => {
      await dispatchShellLine(ctx, '@notes.md summarise this');
      expect(ctx.state.basket.paths).toEqual(['notes.md']);
      expect(ctx.io.errLines[0]).toBe('Context basket: added notes.md');
      expect(ctx.clients[0].asks[0].prompt).toContain('Remember the drift.');

      const quiet = createTestContext({ io: { interactive: false } });
      writeFileSync(join(quiet.cwd, 'notes.md'), 'x');
      await dispatchShellLine(quiet, '/context add notes.md');
      await expect(dispatchShellLine(quiet, 'hello')).rejects.toThrow(
        CONTEXT_CONFIRMATION_REQUIRED
      );

      const declined = createTestContext({ io: { confirms: [false] } });
      writeFileSync(join(declined.cwd, 'notes.md'), 'x');
      await dispatchShellLine(declined, '/context add notes.md');
      await expect(dispatchShellLine(declined, 'hello')).rejects.toThrow('Chat cancelled');
      expect(declined.clients).toHaveLength(1);
      expect(declined.clients[0].asks).toEqual([]);
      await expect(dispatchShellLine(declined, '@missing.md hello')).rejects.toThrow(
        'Not found under'
      );
    });

    it('attaches the packet to session-grounded questions', async () => {
      const store = createTestStore();
      seedSession(store);
      ctx = createTestContext({
        store,
        cwd: ctx.cwd,
        replies: [{ promptStartsWith: 'session-grounded-ask', content: 'Grounded.' }],
        io: { confirms: [true] },
      });
      await dispatchShellLine(ctx, '/context add notes.md');
      await dispatchShellLine(ctx, 'Does the drift match the notes?');
      const prompt = ctx.clients[0].asks[0].prompt;
      expect(prompt).toContain('USER-PROVIDED CONTEXT (files the user attached to this question)');
      expect(prompt).toContain('Remember the drift.');
      expect(prompt).toContain('USER QUESTION\nDoes the drift match the notes?');
    });

    it('manages the basket with /context and /repo', async () => {
      await dispatchShellLine(ctx, '/context');
      expect(ctx.io.outLines[0]).toMatch(/^Context basket: empty\./);
      ctx.io.outLines.length = 0;

      await dispatchShellLine(ctx, '/context add notes.md notes.md');
      await dispatchShellLine(ctx, '/context markdown on');
      await dispatchShellLine(ctx, '/context');
      expect(ctx.io.outLines).toEqual([
        'Added: notes.md',
        'Already present: notes.md',
        'Markdown only: on',
        'Context basket (1 item, Markdown only):',
        '  notes.md',
      ]);
      ctx.io.outLines.length = 0;

      await dispatchShellLine(ctx, '/context show --full');
      expect(ctx.io.outLines[0]).toMatch(/^Context basket: 1 file, /);
      expect(ctx.io.text()).toContain('Remember the drift.');
      ctx.io.outLines.length = 0;

      await expect(dispatchShellLine(ctx, '/context add missing.txt')).rejects.toThrow(
        'Not found under'
      );
      await expect(dispatchShellLine(ctx, '/context rm nope')).rejects.toThrow(
        'Not in the basket: nope'
      );
      await expect(dispatchShellLine(ctx, '/context markdown maybe')).rejects.toThrow(
        'Usage: /context'
      );
      await dispatchShellLine(ctx, '/context rm notes.md');
      await dispatchShellLine(ctx, '/context clear');
      expect(ctx.state.basket.paths).toEqual([]);

      await dispatchShellLine(ctx, '/repo');
      expect(ctx.io.outLines.at(-1)).toBe(`Repository root: ${ctx.cwd}`);
      await expect(dispatchShellLine(ctx, '/repo missing-dir')).rejects.toThrow('Not a directory');
    });

    it('pastes text with /context add-text', async () => {
      ctx = createTestContext({ io: { blocks: ['Error: boom'] } });
      await dispatchShellLine(ctx, '/context add-text Stack trace');
      expect(ctx.io.questions).toEqual(['Paste the text for "Stack trace"']);
      expect(ctx.state.basket.snippets[0]).toMatchObject({ label: 'Stack trace' });
      expect(ctx.io.outLines[0]).toMatch(/^Added pasted text "Stack trace" \(\d+ bytes\)$/);
    });

    it('feeds the basket and repository into /run', async () => {
      await dispatchShellLine(ctx, '/context add notes.md');
      await dispatchShellLine(ctx, '/run "Explain the drift" --dry-run --providers duck-a,duck-b');
      const errText = ctx.io.errLines.join('\n');
      expect(errText).toContain(`Repository: ${ctx.cwd}`);
      expect(errText).toContain('include notes.md');
      expect(errText).toContain('Context preview: 1 files');
    });
  });

  it('prints a lone successful reply bare and labels the rest', () => {
    expect(replyText([{ provider: 'a', text: 'only', elapsedMs: 0 }])).toBe('only');
    expect(replyText([{ provider: 'a', error: 'down', elapsedMs: 0 }])).toBe(
      '[a · 0s]\nerror: down'
    );
  });
});
