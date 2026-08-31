import {
  MIN_CONTEXT_QUOTE_LENGTH,
  describeEvidence,
  lacksVerifiedContextEvidence,
  verifyEvidence,
} from '../../src/research/evidence.js';

const packet = [
  'FILE: docs/notes.md',
  'Observed failures cluster at market open.',
  'Latency   spikes    follow the first trade burst.',
].join('\n');

describe('verifyEvidence', () => {
  it('verifies context quotes that appear in the packet, tolerating whitespace and case', () => {
    const result = verifyEvidence(
      [
        {
          claim: 'Failures cluster at open',
          basis: 'context',
          contextQuote: 'observed FAILURES cluster at market open.',
        },
        {
          claim: 'Latency follows the burst',
          basis: 'context',
          contextQuote: 'Latency spikes follow the first trade burst.',
        },
      ],
      packet
    );
    expect(result.map((entry) => entry.verification)).toEqual(['verified', 'verified']);
  });

  it('marks missing, absent, and too-short quotes as unverified', () => {
    const result = verifyEvidence(
      [
        { claim: 'No quote given', basis: 'context' },
        {
          claim: 'Quote not in packet',
          basis: 'context',
          contextQuote: 'This sentence appears nowhere in the shared packet.',
        },
        { claim: 'Trivially short', basis: 'context', contextQuote: 'open.' },
      ],
      packet
    );
    expect(result.map((entry) => entry.verification)).toEqual([
      'unverified',
      'unverified',
      'unverified',
    ]);
    expect('open.'.length).toBeLessThan(MIN_CONTEXT_QUOTE_LENGTH);
  });

  it('records non-context bases as not-applicable instead of pretending to verify them', () => {
    const result = verifyEvidence(
      [
        { claim: 'A textbook result', basis: 'general-knowledge' },
        { claim: 'A conjecture', basis: 'speculation' },
      ],
      packet
    );
    expect(result.map((entry) => entry.verification)).toEqual([
      'not-applicable',
      'not-applicable',
    ]);
  });
});

describe('evidence summaries', () => {
  it('describes the mix of bases and verification outcomes', () => {
    const summary = describeEvidence([
      { claim: 'a', basis: 'context', contextQuote: 'q', verification: 'verified' },
      { claim: 'b', basis: 'context', contextQuote: 'q', verification: 'unverified' },
      { claim: 'c', basis: 'general-knowledge', verification: 'not-applicable' },
      { claim: 'd', basis: 'speculation', verification: 'not-applicable' },
    ]);
    expect(summary).toBe(
      '1 verified context · 1 unverified context · 1 general knowledge · 1 speculation'
    );
    expect(describeEvidence([])).toBe('none declared');
    expect(describeEvidence(undefined)).toBe('none declared');
  });

  it('flags hypotheses with no verified tie to the shared packet', () => {
    expect(
      lacksVerifiedContextEvidence([
        { claim: 'a', basis: 'general-knowledge', verification: 'not-applicable' },
      ])
    ).toBe(true);
    expect(
      lacksVerifiedContextEvidence([
        { claim: 'a', basis: 'context', contextQuote: 'q', verification: 'verified' },
      ])
    ).toBe(false);
    expect(lacksVerifiedContextEvidence(undefined)).toBe(true);
  });
});
