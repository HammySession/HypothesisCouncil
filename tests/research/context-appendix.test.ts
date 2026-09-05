import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildContextPacket, withAppendix } from '../../src/research/context.js';

describe('context packet appendix', () => {
  it('reserves bytes for an appendix and re-seals the manifest when it is added', () => {
    const root = mkdtempSync(join(tmpdir(), 'hc-appendix-'));
    writeFileSync(join(root, 'notes.md'), 'n'.repeat(600));

    const plain = buildContextPacket(['.'], 400, root);
    const reserved = buildContextPacket(['.'], 400, root, { reserveBytes: 150 });

    expect(plain.manifest.reservedBytes).toBeUndefined();
    expect(reserved.manifest).toMatchObject({ maxBytes: 400, reservedBytes: 150 });
    expect(reserved.manifest.packetBytes).toBeLessThanOrEqual(250);
    expect(reserved.manifest.files[0].includedBytes).toBeLessThan(
      plain.manifest.files[0].includedBytes
    );

    const appendix = `===== SOURCES =====\n${'s'.repeat(80)}\n===== END SOURCES =====`;
    const sealed = withAppendix(reserved, appendix);
    expect(sealed.packet.endsWith(`${appendix}\n`)).toBe(true);
    expect(sealed.packet.startsWith(`${reserved.packet.trimEnd()}\n\n`)).toBe(true);
    expect(sealed.manifest.packetBytes).toBe(Buffer.byteLength(sealed.packet));
    expect(sealed.manifest.appendixBytes).toBe(Buffer.byteLength(appendix));
    expect(sealed.manifest.packetSha256).not.toBe(reserved.manifest.packetSha256);
    expect(sealed.manifest.files).toEqual(reserved.manifest.files);
    expect(withAppendix(reserved, '  ')).toBe(reserved);
  });

  it('rejects an appendix that overflows the budget and invalid reservations', () => {
    const root = mkdtempSync(join(tmpdir(), 'hc-appendix-overflow-'));
    writeFileSync(join(root, 'notes.md'), 'n'.repeat(100));
    const built = buildContextPacket(['.'], 300, root, { reserveBytes: 50 });
    expect(() => withAppendix(built, 'x'.repeat(400))).toThrow('exceeded its 300-byte budget');
    expect(() => buildContextPacket(['.'], 300, root, { reserveBytes: 300 })).toThrow(
      'reserveBytes'
    );
    expect(() => buildContextPacket(['.'], 300, root, { reserveBytes: -1 })).toThrow(
      'reserveBytes'
    );
  });
});
