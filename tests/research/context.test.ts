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

  it('expands glob patterns deterministically without traversing denied directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'hc-context-glob-'));
    mkdirSync(join(root, 'src', 'nested'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;');
    writeFileSync(join(root, 'src', 'nested', 'b.ts'), 'export const b = 2;');
    writeFileSync(join(root, 'src', 'style.css'), 'body {}');
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.ts'), 'export const hidden = 3;');
    writeFileSync(join(root, 'top.ts'), 'export const top = 4;');

    const result = buildContextPacket(['**/*.ts'], 4096, root);

    expect(result.manifest.files.map((file) => file.path)).toEqual([
      'src/a.ts',
      'src/nested/b.ts',
      'top.ts',
    ]);
    expect(result.manifest.deniedPaths).toEqual([]);
    expect(result.manifest.unmatchedRequestedPaths).toEqual([]);
    expect(result.packet).not.toContain('hidden');
  });

  it('records requested paths and globs that matched no eligible files', () => {
    const root = mkdtempSync(join(tmpdir(), 'hc-context-unmatched-'));
    writeFileSync(join(root, 'README.md'), '# Project');
    writeFileSync(join(root, 'trace.log'), 'noise');

    const result = buildContextPacket(
      ['README.md', 'trace.log', 'missing.md', 'docs/**/*.md'],
      2048,
      root
    );

    expect(result.manifest.files.map((file) => file.path)).toEqual(['README.md']);
    expect(result.manifest.unmatchedRequestedPaths).toEqual([
      'docs/**/*.md',
      'missing.md',
      'trace.log',
    ]);
    expect(result.manifest.omittedPaths).toEqual(
      expect.arrayContaining(['trace.log', 'missing.md'])
    );
  });

  it('does not flag overlapping requests whose files were already collected', () => {
    const root = mkdtempSync(join(tmpdir(), 'hc-context-overlap-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'main.ts'), 'export const main = 1;');

    const result = buildContextPacket(['.', 'src/*.ts'], 2048, root);

    expect(result.manifest.files.map((file) => file.path)).toEqual(['src/main.ts']);
    expect(result.manifest.unmatchedRequestedPaths).toEqual([]);
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
