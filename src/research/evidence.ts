import type { HypothesisEvidence } from './schemas.js';
import type { SourceRecord } from './sources.js';
import type { VerifiedEvidence } from './types.js';

/**
 * Quotes shorter than this (after whitespace normalization) match the packet too easily to count
 * as grounding, so they are recorded as unverified rather than trivially verified.
 */
export const MIN_CONTEXT_QUOTE_LENGTH = 12;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** `S-1`, `s-001`, and `S001` all name the record `S-001`. */
export function normalizeSourceId(value: string | undefined): string | undefined {
  const match = /^\s*s-?0*(\d+)\s*$/i.exec(value ?? '');
  return match ? `S-${match[1].padStart(3, '0')}` : undefined;
}

/** Whether a cited source counts as support at all under the discount rule. */
export function isWeakSourceEvidence(entry: VerifiedEvidence): boolean {
  if (entry.basis !== 'source') return false;
  if (entry.reliability !== undefined && entry.reliability < 4) return true;
  return entry.replication === 'contested';
}

/**
 * Deterministic, local provenance check: a `context` evidence entry is verified only when its
 * quote actually appears in the file part of the shared context packet. No model is consulted, so
 * a provider cannot launder remembered literature into "context" evidence without being flagged.
 * A `source` entry is verified only when it names a session source record that was fetched and is
 * not retracted; the record's critique grade travels with the entry so reviewers see it.
 */
export function verifyEvidence(
  evidence: HypothesisEvidence[],
  contextPacket: string,
  sources: SourceRecord[] = []
): VerifiedEvidence[] {
  const packet = normalize(contextPacket);
  return evidence.map((entry) => {
    if (entry.basis === 'source') {
      const id = normalizeSourceId(entry.sourceId);
      const record = id ? sources.find((source) => source.id === id) : undefined;
      const verified = record?.verification?.status === 'reachable';
      const graded: VerifiedEvidence = {
        ...entry,
        sourceId: id ?? entry.sourceId,
        verification: verified ? 'verified' : 'unverified',
      };
      if (record?.critique) {
        graded.reliability = record.critique.reliability;
        graded.replication = record.critique.replication;
        if (record.critique.concerns.length > 0) graded.concerns = record.critique.concerns;
      }
      return graded;
    }
    if (entry.basis !== 'context') return { ...entry, verification: 'not-applicable' };
    const quote = normalize(entry.contextQuote ?? '');
    const verified = quote.length >= MIN_CONTEXT_QUOTE_LENGTH && packet.includes(quote);
    return { ...entry, verification: verified ? 'verified' : 'unverified' };
  });
}

/** One-line evidence-basis summary for reports and the CLI, e.g. `2 verified context · 1 speculation`. */
export function describeEvidence(evidence: VerifiedEvidence[] | undefined): string {
  if (!evidence || evidence.length === 0) return 'none declared';
  let verified = 0;
  let unverified = 0;
  let verifiedSources = 0;
  let unverifiedSources = 0;
  let generalKnowledge = 0;
  let speculation = 0;
  for (const entry of evidence) {
    if (entry.basis === 'context') {
      if (entry.verification === 'verified') verified++;
      else unverified++;
    } else if (entry.basis === 'source') {
      if (entry.verification === 'verified') verifiedSources++;
      else unverifiedSources++;
    } else if (entry.basis === 'general-knowledge') generalKnowledge++;
    else speculation++;
  }
  const parts: string[] = [];
  if (verified > 0) parts.push(`${verified} verified context`);
  if (unverified > 0) parts.push(`${unverified} unverified context`);
  if (verifiedSources > 0) parts.push(`${verifiedSources} verified source`);
  if (unverifiedSources > 0) parts.push(`${unverifiedSources} unverified source`);
  if (generalKnowledge > 0) parts.push(`${generalKnowledge} general knowledge`);
  if (speculation > 0) parts.push(`${speculation} speculation`);
  return parts.join(' · ');
}

/**
 * True when nothing verified carries the hypothesis: no context quote found in the packet and no
 * fetched source. With `discountWeakSources`, a source graded unreliable or contested does not
 * count either.
 */
export function lacksVerifiedContextEvidence(
  evidence: VerifiedEvidence[] | undefined,
  options: { discountWeakSources?: boolean } = {}
): boolean {
  return !evidence?.some(
    (entry) =>
      entry.verification === 'verified' &&
      !(options.discountWeakSources && isWeakSourceEvidence(entry))
  );
}
