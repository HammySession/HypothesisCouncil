import { z } from 'zod';

const confidence = z.number().transform((value) => Math.max(0, Math.min(1, value)));

export const GeneratedHypothesisSchema = z.object({
  title: z.string().min(1),
  claim: z.string().min(1),
  mechanism: z.string().min(1),
  predictions: z.array(z.string()).min(1),
  assumptions: z.array(z.string()),
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

export type GeneratedHypothesis = z.infer<typeof GeneratedHypothesisSchema>;
export type GenerationOutput = z.infer<typeof GenerationOutputSchema>;
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;
export type FalsificationOutput = z.infer<typeof FalsificationOutputSchema>;
