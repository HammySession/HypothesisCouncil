import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

export const DEFAULT_HISTORY_LIMIT = 500;

/**
 * Read persisted shell history. The file stores oldest-first; readline expects newest-first.
 */
export function loadShellHistory(path: string, limit = DEFAULT_HISTORY_LIMIT): string[] {
  try {
    return readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}

/** Prepend a line, dropping an identical earlier entry, and cap the list. */
export function rememberShellLine(
  history: string[],
  line: string,
  limit = DEFAULT_HISTORY_LIMIT
): string[] {
  const trimmed = line.trim();
  if (!trimmed) return history;
  return [trimmed, ...history.filter((entry) => entry !== trimmed)].slice(0, limit);
}

/** Persist newest-first history as an oldest-first file so it can be appended by hand. */
export function saveShellHistory(path: string, history: string[]): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${[...history].reverse().join('\n')}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    // History is a convenience; never fail the shell over it.
  }
}
