import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findCommand } from '../../src/cli/path-lookup.js';

describe('findCommand', () => {
  it('finds executables on PATH, honoring Windows PATHEXT and explicit paths', () => {
    const bin = mkdtempSync(join(tmpdir(), 'hc-path-'));
    writeFileSync(join(bin, 'grok.EXE'), '');
    writeFileSync(join(bin, 'claude'), '');

    expect(findCommand('grok', { PATH: bin, PATHEXT: '.COM;.EXE' }, 'win32')).toBe(
      join(bin, 'grok.EXE')
    );
    expect(findCommand('claude', { PATH: bin }, 'linux')).toBe(join(bin, 'claude'));
    expect(findCommand('grok', { PATH: bin }, 'linux')).toBeUndefined();
    expect(findCommand(join(bin, 'claude'), { PATH: '' }, 'linux')).toBe(join(bin, 'claude'));
    expect(findCommand('missing', { PATH: bin }, 'win32')).toBeUndefined();
    expect(findCommand('claude', {}, 'linux')).toBeUndefined();
  });
});
