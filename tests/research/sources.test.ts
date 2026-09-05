import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  SOURCES_SECTION_BEGIN,
  SOURCES_SECTION_END,
  canonicalUrl,
  isScoutProvider,
  normalizeDoi,
  normalizeSources,
  parseSourcesFile,
  parseSourcesText,
  publicSource,
  renderSourcesSection,
  sourcePriority,
  splitAppendix,
  type SourceRecord,
} from '../../src/research/sources.js';

describe('source identifiers', () => {
  it('normalizes DOIs and canonical URLs', () => {
    expect(normalizeDoi('https://doi.org/10.1000/ABC.123')).toBe('10.1000/abc.123');
    expect(normalizeDoi('doi:10.1000/xyz,')).toBe('10.1000/xyz');
    expect(normalizeDoi('not a doi')).toBeUndefined();
    expect(canonicalUrl('HTTPS://Example.org/Paper/?utm_source=x&id=2#abstract')).toBe(
      'https://example.org/Paper/?id=2'
    );
    expect(canonicalUrl('https://example.org/')).toBe('https://example.org');
    expect(canonicalUrl('ftp://example.org/file')).toBeUndefined();
    expect(canonicalUrl('nonsense')).toBeUndefined();
  });

  it('recognizes scout providers by name', () => {
    expect(isScoutProvider('cli-claude_scout')).toBe(true);
    expect(isScoutProvider('grok-scout')).toBe(true);
    expect(isScoutProvider('cli-claude')).toBe(false);
    expect(isScoutProvider('scoutmaster')).toBe(false);
  });
});

describe('parseSourcesText', () => {
  it('reads JSON objects, arrays, and string entries', () => {
    const records = parseSourcesText(
      JSON.stringify({
        sources: [
          {
            title: 'Cache coherence in practice',
            url: 'https://example.org/cache',
            year: '2021',
            venue: 'SOSP',
            kind: 'paper',
            summary: 'Measures invalidation storms.',
          },
          { doi: 'https://doi.org/10.1000/XYZ' },
          'https://example.org/bare',
          { notes: 'no title, no url' },
        ],
      }),
      'sources.json'
    );
    expect(records).toEqual([
      {
        title: 'Cache coherence in practice',
        url: 'https://example.org/cache',
        doi: undefined,
        year: 2021,
        venue: 'SOSP',
        summary: 'Measures invalidation storms.',
        kind: 'paper',
      },
      expect.objectContaining({ title: 'doi:10.1000/xyz', doi: '10.1000/xyz' }),
      expect.objectContaining({
        title: 'https://example.org/bare',
        url: 'https://example.org/bare',
      }),
    ]);
    expect(parseSourcesText('[]', 'x.json')).toEqual([]);
    expect(() => parseSourcesText('{"nope": 1}', 'x.json')).toThrow('"sources" array');
    expect(() => parseSourcesText('{oops', 'x.json')).toThrow('not valid JSON');
  });

  it('reads Markdown bullets, links, bare URLs, and DOIs', () => {
    const records = parseSourcesText(
      [
        '# Reading list',
        '',
        '- [Latency at market open](https://example.org/open) — SOSP 2021',
        '* Clock drift survey https://example.org/drift',
        '1. https://example.org/bare-url',
        '- Retracted result, doi:10.1000/retracted',
        '- A book with no link (1999)',
        '',
      ].join('\n'),
      'sources.md'
    );
    expect(records.map((record) => [record.title, record.url, record.doi, record.year])).toEqual([
      ['Latency at market open', 'https://example.org/open', undefined, 2021],
      ['Clock drift survey', 'https://example.org/drift', undefined, undefined],
      ['https://example.org/bare-url', 'https://example.org/bare-url', undefined, undefined],
      ['Retracted result', undefined, '10.1000/retracted', undefined],
      ['A book with no link (1999)', undefined, undefined, 1999],
    ]);
  });

  it('reads a file and reports a missing one', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hc-sources-'));
    const path = join(directory, 'sources.txt');
    writeFileSync(path, '- https://example.org/a\n- https://example.org/b\n');
    expect(parseSourcesFile(path)).toHaveLength(2);
    expect(() => parseSourcesFile(join(directory, 'missing.md'))).toThrow('Sources file not found');
  });
});

describe('normalizeSources', () => {
  it('assigns stable ids, drops duplicates, and keeps existing records untouched', () => {
    const first = normalizeSources(
      [],
      [
        { title: 'Alpha', url: 'https://example.org/alpha?utm_source=x' },
        { title: 'Beta', doi: '10.1000/beta', year: '2020', kind: 'Dataset' },
      ],
      'user'
    );
    expect(first.sources.map((record) => record.id)).toEqual(['S-001', 'S-002']);
    expect(first.sources[0]).toEqual({
      id: 'S-001',
      title: 'Alpha',
      url: 'https://example.org/alpha',
      origin: 'user',
      kind: 'other',
    });
    expect(first.sources[1]).toMatchObject({
      id: 'S-002',
      doi: '10.1000/beta',
      year: 2020,
      kind: 'dataset',
    });

    const second = normalizeSources(
      first.sources,
      [
        { title: 'ALPHA', url: 'https://example.org/alpha' },
        { title: 'Beta again', url: 'https://doi.org/10.1000/BETA' },
        { title: 'Gamma', url: 'https://example.org/gamma', summary: 'New.' },
      ],
      'scout',
      'cli-claude_scout'
    );
    expect(second.duplicates).toBe(2);
    expect(second.added).toEqual([
      {
        id: 'S-003',
        title: 'Gamma',
        url: 'https://example.org/gamma',
        summary: 'New.',
        origin: 'scout',
        kind: 'other',
        scoutProvider: 'cli-claude_scout',
      },
    ]);
    expect(second.sources.slice(0, 2)).toEqual(first.sources);
    expect(publicSource(second.added[0])).not.toHaveProperty('scoutProvider');
  });
});

describe('renderSourcesSection', () => {
  const records: SourceRecord[] = [
    {
      id: 'S-001',
      title: 'Alpha paper',
      url: 'https://example.org/alpha',
      year: 2021,
      venue: 'SOSP',
      origin: 'user',
      kind: 'paper',
      verification: { status: 'reachable', checkedAt: 'now', titleFound: true },
    },
    {
      id: 'S-002',
      title: 'Beta preprint',
      doi: '10.1000/beta',
      summary: 'Claims the opposite.',
      origin: 'scout',
      kind: 'preprint',
      scoutProvider: 'cli-grok_scout',
      verification: { status: 'reachable', checkedAt: 'now', titleFound: false },
      critique: { reliability: 3, replication: 'contested', concerns: ['n=4', 'no controls'] },
    },
    { id: 'S-003', title: 'Offline book', origin: 'user', kind: 'other' },
  ];

  it('renders records with mechanical status and labels model text as unverified', () => {
    const section = renderSourcesSection(records);
    expect(section.startsWith(`${SOURCES_SECTION_BEGIN}\n`)).toBe(true);
    expect(section.endsWith(SOURCES_SECTION_END)).toBe(true);
    expect(section).toContain(
      'S-001 | paper | user-supplied | reachable | Alpha paper (2021, SOSP)'
    );
    expect(section).toContain('  url: https://example.org/alpha');
    expect(section).toContain(
      'S-002 | preprint | scouted | reachable (title not found on page) | Beta preprint'
    );
    expect(section).toContain('  summary (model-written, unverified): Claims the opposite.');
    expect(section).toContain(
      '  critique (model-assessed): reliability 3/10, replication contested; concerns: n=4; no controls'
    );
    expect(section).toContain('S-003 | other | user-supplied | unchecked | Offline book');
    expect(section).not.toContain('cli-grok_scout');
  });

  it('splits a packet back into files and appendix, and orders records for trimming', () => {
    const appendix = renderSourcesSection(records);
    const packet = `===== FILE: a.md =====\nhello\n===== END FILE =====\n\n${appendix}`;
    expect(splitAppendix(packet)).toEqual({
      filePacket: '===== FILE: a.md =====\nhello\n===== END FILE =====',
      appendix,
    });
    expect(splitAppendix('plain packet')).toEqual({ filePacket: 'plain packet' });
    expect(splitAppendix(appendix)).toEqual({ filePacket: '', appendix });
    expect(records.map(sourcePriority)).toEqual([5, 107, 5]);
  });
});
