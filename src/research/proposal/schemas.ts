import { z } from 'zod';

const confidence = z.number().transform((value) => Math.max(0, Math.min(1, value)));
const score = z.number().min(1).max(10);
const text = z.string().min(1);
const textList = z.array(z.string().min(1));

export const InterviewQuestionOutputSchema = z.object({
  question: text,
  whyItMatters: text,
  priority: z.enum(['high', 'medium', 'low']),
});

export const InterviewOutputSchema = z.object({
  questions: z.array(InterviewQuestionOutputSchema),
  /** True when the provider has nothing further to ask. */
  done: z.boolean().optional(),
});

export const ExperimentStepSchema = z.object({
  step: z.number().int().min(1),
  title: text,
  method: text,
  metrics: textList,
  successCriteria: text,
  killCriteria: text,
  resources: textList,
  estimatedEffort: text,
  dependsOn: z.array(z.number().int().min(1)).optional(),
});

export const ProposalHypothesisSchema = z.object({
  statement: text,
  rationale: text,
  falsifier: text,
});

export const ProposalDraftOutputSchema = z.object({
  title: text,
  background: text,
  hypotheses: z.array(ProposalHypothesisSchema).min(1),
  experiments: z.array(ExperimentStepSchema).min(1),
  risks: textList,
  dataNeeds: textList,
  deliverables: textList,
  openAssumptions: textList.optional(),
});

export const ProposalCritiqueOutputSchema = z.object({
  feasibility: score,
  rigor: score,
  clarity: score,
  completeness: score,
  killCriteriaQuality: z.enum(['concrete', 'vague', 'untestable']),
  fatalGap: z.string().nullable().optional(),
  strongestObjection: text,
  missingSteps: textList,
  suggestedChanges: textList,
  verdict: z.enum(['strong_accept', 'accept', 'uncertain', 'reject', 'fatal']),
  confidence,
});

export const MergedProposalOutputSchema = ProposalDraftOutputSchema.extend({
  rationale: text,
  alternatives: textList,
});

export type InterviewQuestionOutput = z.infer<typeof InterviewQuestionOutputSchema>;
export type InterviewOutput = z.infer<typeof InterviewOutputSchema>;
export type ExperimentStep = z.infer<typeof ExperimentStepSchema>;
export type ProposalHypothesis = z.infer<typeof ProposalHypothesisSchema>;
export type ProposalDraftOutput = z.infer<typeof ProposalDraftOutputSchema>;
export type ProposalCritiqueOutput = z.infer<typeof ProposalCritiqueOutputSchema>;
export type MergedProposalOutput = z.infer<typeof MergedProposalOutputSchema>;
