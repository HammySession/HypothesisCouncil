import { z } from 'zod';

const confidence = z.number().transform((value) => Math.max(0, Math.min(1, value)));

/**
 * Where a supporting claim comes from. `context` quotes are checked against the sealed packet,
 * `source` entries point at a numbered record from a SOURCES section, and the other two are
 * self-declared memory or conjecture.
 */
export const EVIDENCE_BASES = ['context', 'general-knowledge', 'speculation', 'source'] as const;

export const HypothesisEvidenceSchema = z.object({
  claim: z.string().min(1),
  basis: z.enum(EVIDENCE_BASES),
  contextQuote: z.string().optional(),
  /** Id of the cited source record (for example `S-001`) when `basis` is `source`. */
  sourceId: z.string().optional(),
});

export const GeneratedHypothesisSchema = z.object({
  title: z.string().min(1),
  claim: z.string().min(1),
  mechanism: z.string().min(1),
  predictions: z.array(z.string()).min(1),
  assumptions: z.array(z.string()),
  differsFromConsensus: z.string().min(1),
  evidence: z.array(HypothesisEvidenceSchema).min(1),
  falsifier: z.string().min(1),
  minimalExperiment: z.string().min(1),
  confidence,
});

export const GenerationOutputSchema = z.object({
  hypotheses: z.array(GeneratedHypothesisSchema).min(1),
});

const reviewScore = z.number().min(1).max(10);

export const ReviewOutputSchema = z.object({
  plausibility: reviewScore,
  novelty: reviewScore,
  testability: reviewScore,
  falsifiability: reviewScore,
  feasibility: reviewScore,
  robustness: reviewScore,
  killCriterion: z.enum(['concrete', 'vague', 'untestable']),
  fatalFlaw: z.string().nullable().optional(),
  strongestObjection: z.string().min(1),
  hiddenAssumptions: z.array(z.string()),
  proposedDiscriminatingTest: z.string().min(1),
  verdict: z.enum(['strong_accept', 'accept', 'uncertain', 'reject', 'fatal']),
  confidence,
});

export const FalsificationOutputSchema = z.object({
  damagingAssumption: z.string().min(1),
  competingExplanation: z.string().min(1),
  falsifyingObservation: z.string().min(1),
  discriminatingExperiment: z.string().min(1),
  remainsUsefulIfMechanismFalse: z.string().min(1),
});

/** Models return years as numbers or strings; normalization happens when records are merged. */
const optionalYear = z.union([z.number(), z.string()]).optional();

export const SOURCE_KIND_VALUES = [
  'paper',
  'preprint',
  'dataset',
  'code',
  'documentation',
  'article',
  'other',
] as const;

/** One record a web scout proposes; a record needs a URL or a DOI to be kept. */
export const ScoutedSourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().optional().nullable(),
  doi: z.string().optional().nullable(),
  year: optionalYear.nullable(),
  venue: z.string().optional().nullable(),
  kind: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
});

export const SourceScoutOutputSchema = z.object({
  sources: z.array(ScoutedSourceSchema),
});

export const SOURCE_REPLICATIONS = ['replicated', 'unreplicated', 'contested', 'unknown'] as const;

export const SourceAssessmentSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(SOURCE_KIND_VALUES).optional().nullable(),
  reliability: z.number().min(1).max(10),
  replication: z.enum(SOURCE_REPLICATIONS),
  concerns: z.array(z.string()),
});

export const SourceCritiqueOutputSchema = z.object({
  assessments: z.array(SourceAssessmentSchema),
});

export type HypothesisEvidence = z.infer<typeof HypothesisEvidenceSchema>;
export type ScoutedSource = z.infer<typeof ScoutedSourceSchema>;
export type SourceScoutOutput = z.infer<typeof SourceScoutOutputSchema>;
export type SourceAssessment = z.infer<typeof SourceAssessmentSchema>;
export type SourceCritiqueOutput = z.infer<typeof SourceCritiqueOutputSchema>;
export type EvidenceBasis = HypothesisEvidence['basis'];
export type GeneratedHypothesis = z.infer<typeof GeneratedHypothesisSchema>;
export type GenerationOutput = z.infer<typeof GenerationOutputSchema>;
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;
export type KillCriterionAssessment = ReviewOutput['killCriterion'];
export type FalsificationOutput = z.infer<typeof FalsificationOutputSchema>;
