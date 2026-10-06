import { createProgressRenderer } from '../../src/cli/progress.js';

describe('progress renderer', () => {
  it('prints one plain line per finished event when not attached to a terminal', () => {
    const output: string[] = [];
    const renderer = createProgressRenderer({
      write: (text) => void output.push(text),
      live: false,
    });

    void renderer.handle({
      stage: 'generating',
      completed: 0,
      total: 2,
      message: 'duck-a generating',
      subject: 'duck-a',
      event: 'started',
    });
    void renderer.handle({
      stage: 'generating',
      completed: 1,
      total: 2,
      message: 'Generation 1/2; candidates sealed',
      subject: 'duck-a',
      event: 'finished',
    });
    renderer.finish();

    expect(output).toEqual(['[generating] 1/2 Generation 1/2; candidates sealed\n']);
  });

  it('rewrites a live status line with in-flight work and elapsed time', () => {
    let clock = 0;
    const output: string[] = [];
    const renderer = createProgressRenderer({
      write: (text) => void output.push(text),
      live: true,
      now: () => clock,
      tickMs: 60_000,
      columns: 120,
    });

    void renderer.handle({
      stage: 'generating',
      completed: 0,
      total: 2,
      message: 'duck-a generating',
      subject: 'duck-a',
      event: 'started',
    });
    void renderer.handle({
      stage: 'generating',
      completed: 0,
      total: 2,
      message: 'duck-b generating',
      subject: 'duck-b',
      event: 'started',
    });
    clock = 65_000;
    void renderer.handle({
      stage: 'generating',
      completed: 1,
      total: 2,
      message: 'Generation 1/2; candidates sealed',
      subject: 'duck-a',
      event: 'finished',
    });
    void renderer.handle({
      stage: 'reviewing',
      completed: 0,
      total: 4,
      message: 'Reviewing H-001',
      subject: 'H-001',
      event: 'started',
    });
    renderer.finish();

    expect(output[1]).toBe(
      '\r\x1b[2K[generating] 0/2 · duck-b generating · in flight: duck-a, duck-b · 0s'
    );
    expect(output[2]).toBe(
      '\r\x1b[2K[generating] 1/2 · Generation 1/2; candidates sealed · in flight: duck-b · 1m 05s'
    );
    expect(output[3]).toBe('\n');
    expect(output[4]).toBe(
      '\r\x1b[2K[reviewing] 0/4 · Reviewing H-001 · in flight: H-001 · 1m 05s'
    );
    expect(output.at(-1)).toBe('\n');
  });

  it('truncates live lines to the terminal width', () => {
    const output: string[] = [];
    const renderer = createProgressRenderer({
      write: (text) => void output.push(text),
      live: true,
      now: () => 0,
      tickMs: 60_000,
      columns: 30,
    });

    void renderer.handle({
      stage: 'generating',
      completed: 0,
      total: 4,
      message: 'a very long progress message that does not fit',
    });
    renderer.finish();

    expect(output[0].length).toBeLessThanOrEqual('\r\x1b[2K'.length + 29);
    expect(output[0].endsWith('...')).toBe(true);
  });
});
