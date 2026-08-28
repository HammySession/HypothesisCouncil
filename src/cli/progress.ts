import type { ResearchProgress, ResearchProgressHandler } from '../research/types.js';
import { formatDuration } from './format.js';

export interface ProgressRendererOptions {
  write: (text: string) => void;
  /** Rewrite one status line in place (terminal) instead of appending a line per event. */
  live: boolean;
  columns?: number;
  now?: () => number;
  tickMs?: number;
}

export interface ProgressRenderer {
  handle: ResearchProgressHandler;
  /** Stop the elapsed-time ticker and leave the cursor on a fresh line. */
  finish(): void;
}

/**
 * Renders orchestrator progress. In live mode a single line shows the stage, counts, the units of
 * work still in flight (provider names during generation, candidate ids during review), and the
 * elapsed time; each stage's final line is kept when the next stage begins.
 */
export function createProgressRenderer(options: ProgressRendererOptions): ProgressRenderer {
  const now = options.now || Date.now;
  const startedAt = now();
  const inFlight = new Set<string>();
  let stage: ResearchProgress['stage'] | undefined;
  let completed = 0;
  let total = 0;
  let message = '';
  let lineShown = false;

  const counts = () => (total > 0 ? ` ${completed}/${total}` : '');
  const line = () => {
    const parts = [`[${stage}]${counts()}`, message];
    if (inFlight.size > 0) parts.push(`in flight: ${[...inFlight].sort().join(', ')}`);
    parts.push(formatDuration(now() - startedAt));
    return parts.filter(Boolean).join(' · ');
  };
  const paint = () => {
    if (!options.live || !stage) return;
    const width = Math.max(20, (options.columns || 100) - 1);
    const text = line();
    options.write(`\r\x1b[2K${text.length > width ? `${text.slice(0, width - 1)}…` : text}`);
    lineShown = true;
  };
  const endLine = () => {
    if (lineShown) options.write('\n');
    lineShown = false;
  };
  const ticker = options.live ? setInterval(paint, options.tickMs ?? 1000) : undefined;
  ticker?.unref();

  return {
    handle: (progress) => {
      if (progress.stage !== stage) {
        endLine();
        stage = progress.stage;
        inFlight.clear();
      }
      if (progress.subject && progress.event === 'started') inFlight.add(progress.subject);
      if (progress.subject && progress.event === 'finished') inFlight.delete(progress.subject);
      completed = progress.completed;
      total = progress.total;
      message = progress.message;
      if (options.live) {
        paint();
      } else if (progress.event !== 'started') {
        options.write(`[${progress.stage}]${counts()} ${message}\n`);
      }
    },
    finish: () => {
      if (ticker) clearInterval(ticker);
      endLine();
    },
  };
}
