import { createInterface, type Interface } from 'readline';

/** Everything a command needs to talk to the person at the terminal, replaceable in tests. */
export interface ShellIO {
  out(text?: string): void;
  err(text: string): void;
  /** True when a person can answer questions (stdin and stderr are terminals). */
  readonly isInteractive: boolean;
  /** Ask a yes/no question; resolves false when nobody can answer. */
  confirm(question: string): Promise<boolean>;
  /** Read lines until one equals `terminator` (or input ends); resolves the joined block. */
  readBlock(prompt: string, terminator?: string): Promise<string>;
  /** Read one line after `prompt`; resolves undefined when nobody can answer or input ends. */
  readLine(prompt: string): Promise<string | undefined>;
}

export type OutputStream = NodeJS.WritableStream & { isTTY?: boolean; columns?: number };

export type InputStream = NodeJS.ReadableStream & { isTTY?: boolean };

export interface TerminalIOOptions {
  stdin: InputStream;
  stdout: OutputStream;
  stderr: OutputStream;
  /**
   * The interactive shell's readline. Questions are routed through it so the answers never reach
   * the shell's own line handler.
   */
  rl?: Interface;
}

export const DEFAULT_BLOCK_TERMINATOR = '.';

function question(rl: Interface, query: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const onClose = () => resolve(undefined);
    rl.once('close', onClose);
    rl.question(query, (answer) => {
      rl.off('close', onClose);
      resolve(answer);
    });
  });
}

export function createTerminalIO(options: TerminalIOOptions): ShellIO {
  const isInteractive = options.stdin.isTTY === true && options.stderr.isTTY === true;

  const withInterface = async <T>(operation: (rl: Interface) => Promise<T>): Promise<T> => {
    if (options.rl) return operation(options.rl);
    const rl = createInterface({ input: options.stdin, output: options.stderr });
    try {
      return await operation(rl);
    } finally {
      rl.close();
    }
  };

  return {
    isInteractive,
    out: (text = '') => void options.stdout.write(`${text}\n`),
    err: (text) => void options.stderr.write(`${text}\n`),
    confirm: async (prompt) => {
      if (!isInteractive) return false;
      const answer = await withInterface((rl) => question(rl, `${prompt} [y/N] `));
      return /^y(?:es)?$/i.test((answer ?? '').trim());
    },
    readLine: async (prompt) => {
      if (!isInteractive) return undefined;
      return withInterface((rl) => question(rl, prompt));
    },
    readBlock: async (prompt, terminator = DEFAULT_BLOCK_TERMINATOR) => {
      if (!isInteractive) return '';
      return withInterface(async (rl) => {
        options.stderr.write(`${prompt} (finish with a line containing only "${terminator}")\n`);
        const lines: string[] = [];
        for (;;) {
          const line = await question(rl, '');
          if (line === undefined || line.trim() === terminator) break;
          lines.push(line);
        }
        return lines.join('\n').trim();
      });
    },
  };
}

export interface MemoryIOOptions {
  /** Answers handed out by `confirm`, in order; the last one repeats. Defaults to `false`. */
  confirms?: boolean[];
  /** Blocks handed out by `readBlock`, in order. */
  blocks?: string[];
  /** Lines handed out by `readLine`, in order; undefined once exhausted. */
  lines?: string[];
  interactive?: boolean;
}

export interface MemoryIO extends ShellIO {
  readonly outLines: string[];
  readonly errLines: string[];
  readonly questions: string[];
  text(): string;
}

/** In-memory IO for tests: records output and replays scripted answers. */
export function createMemoryIO(options: MemoryIOOptions = {}): MemoryIO {
  const outLines: string[] = [];
  const errLines: string[] = [];
  const questions: string[] = [];
  const confirms = [...(options.confirms ?? [])];
  const blocks = [...(options.blocks ?? [])];
  const lines = [...(options.lines ?? [])];
  return {
    outLines,
    errLines,
    questions,
    isInteractive: options.interactive ?? true,
    out: (text = '') => void outLines.push(...text.split('\n')),
    err: (text) => void errLines.push(...text.split('\n')),
    confirm: (prompt) => {
      questions.push(prompt);
      const answer = confirms.length > 1 ? confirms.shift() : confirms[0];
      return Promise.resolve(answer ?? false);
    },
    readBlock: (prompt) => {
      questions.push(prompt);
      return Promise.resolve(blocks.shift() ?? '');
    },
    readLine: (prompt) => {
      questions.push(prompt);
      return Promise.resolve(lines.shift());
    },
    text: () => outLines.join('\n'),
  };
}
