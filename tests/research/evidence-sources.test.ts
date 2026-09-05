import {
  describeEvidence,
  isWeakSourceEvidence,
  lacksVerifiedContextEvidence,
  normalizeSourceId,
  verifyEvidence,
} from '../../src/research/evidence.js';
import type { SourceRecord } from '../../src/research/sources.js';

const sources: SourceRecord[] = [
  {
    id: 'S-001',
    title: 'Reachable paper',
    url: 'https://example.org/a',
    origin: 'user',
    kind: 'paper',
    verification: { status: 'reachable', checkedAt: 'now' },
    critique: { reliability: 8, replication: 'replicated', concerns: [] },
  },
  {
    id: 'S-002',
    title: 'Shaky preprint',
    url: 'https://example.org/b',
    origin: 'scout',
    kind: 'preprint',
    verification: { status: 'reachable', checkedAt: 'now' },
    critique: { reliability: 2, replication: 'contested', concerns: ['n=3'] },
  },
  {
    id: 'S-003',
    title: 'Unfetched',
    url: 'https://example.org/c',
    origin: 'scout',
    kind: 'paper',
    verification: { status: 'unreachable', checkedAt: 'now' },
  },
];

describe('source evidence verification', () => {
  it('normalizes source ids', () => {
    expect(normalizeSourceId('S-001')).toBe('S-001');
    expect(normalizeSourceId('s-1')).toBe('S-001');
    expect(normalizeSourceId(' S007 ')).toBe('S-007');
    expect(normalizeSourceId('H-001')).toBeUndefined();
    expect(normalizeSourceId(undefined)).toBeUndefined();
  });

  it('verifies only citations of fetched records and attaches the critique grade', () => {
    const result = verifyEvidence(
      [
        { claim: 'Grounded', basis: 'source', sourceId: 's-1' },
        { claim: 'Shaky', basis: 'source', sourceId: 'S-002' },
        { claim: 'Unfetched', basis: 'source', sourceId: 'S-003' },
        { claim: 'Made up', basis: 'source', sourceId: 'S-099' },
        { claim: 'No id', basis: 'source' },
      ],
      'file packet text',
      sources
    );
    expect(result).toEqual([
      {
        claim: 'Grounded',
        basis: 'source',
        sourceId: 'S-001',
        verification: 'verified',
        reliability: 8,
        replication: 'replicated',
      },
      {
        claim: 'Shaky',
        basis: 'source',
        sourceId: 'S-002',
        verification: 'verified',
        reliability: 2,
        replication: 'contested',
        concerns: ['n=3'],
      },
      { claim: 'Unfetched', basis: 'source', sourceId: 'S-003', verification: 'unverified' },
      { claim: 'Made up', basis: 'source', sourceId: 'S-099', verification: 'unverified' },
      { claim: 'No id', basis: 'source', sourceId: undefined, verification: 'unverified' },
    ]);
    expect(describeEvidence(result)).toBe('2 verified source · 3 unverified source');
  });

  it('never verifies a source quote against the packet or a source without records', () => {
    const [entry] = verifyEvidence(
      [{ claim: 'x', basis: 'source', sourceId: 'S-001', contextQuote: 'file packet text' }],
      'file packet text'
    );
    expect(entry.verification).toBe('unverified');
  });

  it('discounts weak sources only when the policy asks', () => {
    const [strong, weak] = verifyEvidence(
      [
        { claim: 'a', basis: 'source', sourceId: 'S-001' },
        { claim: 'b', basis: 'source', sourceId: 'S-002' },
      ],
      '',
      sources
    );
    expect(isWeakSourceEvidence(strong)).toBe(false);
    expect(isWeakSourceEvidence(weak)).toBe(true);
    expect(lacksVerifiedContextEvidence([weak])).toBe(false);
    expect(lacksVerifiedContextEvidence([weak], { discountWeakSources: true })).toBe(true);
    expect(lacksVerifiedContextEvidence([strong], { discountWeakSources: true })).toBe(false);
  });
});
