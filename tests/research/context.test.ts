import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildContextPacket } from '../../src/research/context.js';

describe('buildContextPacket', () => {
  it('creates a deterministic bounded manifest and denies secret paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'hc-context-'));
    mkdirSync(join(root, 'notes'));
    writeFileSync(join(root, 'notes', 'research.md'), 'abcdefghij'.repeat(40));
    writeFileSync(join(root, '.env'), 'SECRET=value');

    const result = buildContextPacket(['.'], 256, root);

    expect(result.manifest.files).toHaveLength(1);
    expect(result.manifest.files[0]).toMatchObject({
      path: 'notes/research.md',
      bytes: 400,
      truncated: true,
    });
    expect(result.manifest.deniedPaths).toContain('.env');
    expect(result.packet).toContain('abcdefghij');
    expect(result.packet).not.toContain('SECRET=value');
    expect(result.manifest.packetBytes).toBe(Buffer.byteLength(result.packet));
    expect(result.manifest.packetBytes).toBeLessThanOrEqual(256);
  });

  it('includes only Markdown files when requested and denies local settings', () => {
    const root = mkdtempSync(join(tmpdir(), 'hc-context-markdown-'));
    mkdirSync(join(root, '.claude'));
    writeFileSync(join(root, 'README.md'), '# Project');
    writeFileSync(join(root, 'notes.mdx'), '# Notes');
    writeFileSync(join(root, 'app.ts'), 'export const secret = false;');
    writeFileSync(join(root, '.claude', 'settings.local.json'), '{"permissions":[]}');

    const result = buildContextPacket(['.'], 2048, root, { markdownOnly: true });

    expect(result.manifest.files.map((file) => file.path)).toEqual(['README.md', 'notes.mdx']);
    expect(result.manifest.omittedPaths).toContain('app.ts');
    expect(result.manifest.deniedPaths).toContain('.claude/settings.local.json');
    expect(result.packet).not.toContain('export const');
  });

  it('fairly samples large repositories and gives the model a path manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'hc-context-fair-'));
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'tests'));
    writeFileSync(join(root, 'README.md'), 'R'.repeat(400));
    writeFileSync(join(root, 'src', 'main.ts'), 'S'.repeat(400));
    writeFileSync(join(root, 'tests', 'main.test.ts'), 'T'.repeat(400));

    const result = buildContextPacket(['.'], 600, root);

    expect(result.manifest.files.map((file) => file.path)).toEqual([
      'README.md',
      'src/main.ts',
      'tests/main.test.ts',
    ]);
    expect(result.manifest.files.every((file) => file.includedBytes > 0)).toBe(true);
    expect(result.packet).toContain('===== REPOSITORY FILE MANIFEST =====');
    expect(result.packet.indexOf('README.md')).toBeLessThan(result.packet.indexOf('src/main.ts'));
    expect(result.manifest.packetBytes).toBeLessThanOrEqual(result.manifest.maxBytes);
  });

  it('never exceeds the byte budget when an excerpt ends inside a UTF-8 character', () => {
    const root = mkdtempSync(join(tmpdir(), 'hc-context-utf8-'));
    writeFileSync(join(root, 'unicode.md'), 'é'.repeat(1000));

    const result = buildContextPacket(['.'], 333, root);

    expect(result.packet).not.toContain('�');
    expect(Buffer.byteLength(result.packet)).toBe(result.manifest.packetBytes);
    expect(result.manifest.packetBytes).toBeLessThanOrEqual(333);
  });
});
