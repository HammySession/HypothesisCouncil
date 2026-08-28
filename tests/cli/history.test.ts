import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadShellHistory, rememberShellLine, saveShellHistory } from '../../src/cli/history.js';

describe('shell history', () => {
  it('round-trips newest-first history through an oldest-first file', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'hc-history-')), 'nested', 'shell-history');
    let history = loadShellHistory(path);
    expect(history).toEqual([]);

    history = rememberShellLine(history, '/status');
    history = rememberShellLine(history, '/candidates');
    history = rememberShellLine(history, '   ');
    history = rememberShellLine(history, '/status');
    saveShellHistory(path, history);

    expect(readFileSync(path, 'utf8')).toBe('/candidates\n/status\n');
    expect(loadShellHistory(path)).toEqual(['/status', '/candidates']);
  });

  it('caps the number of remembered lines', () => {
    let history: string[] = [];
    for (let index = 0; index < 5; index++)
      history = rememberShellLine(history, `line ${index}`, 3);
    expect(history).toEqual(['line 4', 'line 3', 'line 2']);
  });
});
