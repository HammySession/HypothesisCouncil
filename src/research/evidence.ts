import type { HypothesisEvidence } from './schemas.js';
import type { VerifiedEvidence } from './types.js';

/**
 * Quotes shorter than this (after whitespace normalization) match the packet too easily to count
 * as grounding, so they are recorded as unverified rather than trivially verified.
 */
export const MIN_CONTEXT_QUOTE_LENGTH = 12;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Deterministic, local provenance check: a `context` evidence entry is verified only when its
 * quote actually appears in the shared context packet. No model is consulted, so a provider
 * cannot launder remembered literature into "context" evidence without being flagged.
 */
export function verifyEvidence(
  evidence: HypothesisEvidence[],
  contextPacket: string
): VerifiedEvidence[] {
  const packet = normalize(contextPacket);
  return evidence.map((entry) => {
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
  let generalKnowledge = 0;
  let speculation = 0;
  for (const entry of evidence) {
    if (entry.basis === 'context') {
      if (entry.verification === 'verified') verified++;
      else unverified++;
    } else if (entry.basis === 'general-knowledge') generalKnowledge++;
    else speculation++;
  }
  const parts: string[] = [];
  if (verified > 0) parts.push(`${verified} verified context`);
  if (unverified > 0) parts.push(`${unverified} unverified context`);
  if (generalKnowledge > 0) parts.push(`${generalKnowledge} general knowledge`);
  if (speculation > 0) parts.push(`${speculation} speculation`);
  return parts.join(' · ');
}

/** True when nothing ties the hypothesis to the shared packet: no verified context evidence. */
export function lacksVerifiedContextEvidence(evidence: VerifiedEvidence[] | undefined): boolean {
  return !evidence?.some((entry) => entry.verification === 'verified');
}
