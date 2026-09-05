import type { DialPolicy } from '../dials.js';
import { NON_INTERACTIVE_NOTICE, dialsLine } from '../prompts.js';
import { dialLabel } from '../settings.js';
import { transcript } from './interview.js';
import { publicCritique, publicDraft, publicProposal } from './public.js';
import type {
  InterviewQuestion,
  PriorFinding,
  ProposalCritique,
  ProposalDraft,
  ProposalSession,
} from './types.js';

export const PROPOSAL_PROMPT_VERSIONS = {
  interview: 'proposal-interview:v1',
  interviewRepair: 'proposal-interview-repair:v1',
  draft: 'proposal-draft:v1',
  draftRepair: 'proposal-draft-repair:v1',
  critique: 'proposal-critique:v1',
  critiqueRepair: 'proposal-critique-repair:v1',
  synthesis: 'proposal-synthesis:v1',
  synthesisRepair: 'proposal-synthesis-repair:v1',
  ask: 'proposal-grounded-ask:v1',
  handoff: 'executor-handoff:v1',
} as const;

export const EXECUTOR_REPORT_BEGIN = '===== HC EXECUTOR REPORT BEGIN =====';
export const EXECUTOR_REPORT_END = '===== HC EXECUTOR REPORT END =====';

type Dials = Pick<DialPolicy, 'novelty' | 'skepticism'>;

function priorFindingsBlock(findings: PriorFinding[] | undefined): string {
  if (!findings || findings.length === 0) return '';
  const lines = findings.map(
    (finding) =>
      `- ${finding.id}${finding.rank ? ` (rank ${finding.rank})` : ''}: ${finding.title}\n  claim: ${finding.claim}\n  mechanism: ${finding.mechanism}\n  falsifier: ${finding.falsifier}\n  minimal experiment: ${finding.minimalExperiment}${finding.reviewVerdict ? `\n  council verdict: ${finding.reviewVerdict}` : ''}`
  );
  return `PRIOR COUNCIL FINDINGS (inputs to build on or refute, not conclusions)\n${lines.join('\n')}\n\n`;
}

function contextBlock(packet: string): string {
  return `RESEARCH CONTEXT (provided by the user; the only material you may inspect)\n${packet.trim() || '(no context files were provided)'}`;
}

function noveltyForDrafts(dials: Dials): string {
  const label = dialLabel(dials.novelty);
  if (label === 'low') {
    return 'NOVELTY GUIDANCE (low): prefer the most reliable, well-trodden design; refinements of standard methods are welcome when the transcript supports them.';
  }
  if (label === 'high') {
    return 'NOVELTY GUIDANCE (high): at least one hypothesis must challenge the assumption the field treats as settled, and at least one experiment must use a method or data source the context never mentions. Tag speculation and give it a concrete falsifier.';
  }
  return 'NOVELTY GUIDANCE (medium): balance a reliable core design with one genuinely new angle.';
}

function skepticismForCritique(dials: Dials): string {
  const label = dialLabel(dials.skepticism);
  if (label === 'high') {
    return 'SKEPTICISM GUIDANCE (high): assume every cited or assumed result may be wrong; treat any kill criterion without a number, a threshold, or a date as vague; demand independent replication before crediting an effect.';
  }
  if (label === 'low') {
    return 'SKEPTICISM GUIDANCE (low): give standard methods the benefit of the doubt; reserve fatal gaps for designs that cannot answer their own question.';
  }
  return 'SKEPTICISM GUIDANCE (medium): grade the design against its own kill criteria; a criterion counts as concrete only when a reader could apply it without asking the author.';
}

export interface InterviewPromptInput {
  session: ProposalSession;
  provider: string;
  packet: string;
  /** Questions this provider may see: its own in sealed mode, everyone's in visible mode. */
  visible: InterviewQuestion[];
  round: number;
  limit: number;
}

/**
 * One sealed interview call. The provider sees the topic, the context, any prior findings, and
 * only the questions it may see with their answers; it never sees which provider asked what.
 */
export function buildInterviewPrompt(input: InterviewPromptInput): string {
  const { session, packet, visible, round, limit } = input;
  const policy = session.config.policy;
  const answered = visible.filter((question) => question.status !== 'open');
  const history =
    round === 1
      ? ''
      : `ANSWERS SO FAR (do not repeat a question already asked here)\n${transcript(session, answered)}\n\n`;
  return `${PROPOSAL_PROMPT_VERSIONS.interview}

${NON_INTERACTIVE_NOTICE}

You are one member of a research council preparing a research proposal. Before anything is designed, the council interviews the person who asked. Your job in this round is to ask the questions whose answers would most change the proposal: goals, constraints, definitions of success, data and resource limits, prior attempts, and anything ambiguous in the topic or the context. Ask only what you cannot infer from the material below. Prefer a few sharp questions over many generic ones.

${dialsLine(policy)}

TOPIC
${session.topic}

${priorFindingsBlock(session.priorFindings)}${history}${contextBlock(packet)}

ROUND ${round} OF ${session.config.maxRounds}
Return at most ${limit} questions. If you have nothing worth asking, return an empty list and set done to true.

Return JSON only:
{
  "questions": [
    { "question": "the question, one sentence", "whyItMatters": "what changes in the proposal depending on the answer", "priority": "high" | "medium" | "low" }
  ],
  "done": true | false
}`;
}

export function buildInterviewRepairPrompt(raw: string): string {
  return `${PROPOSAL_PROMPT_VERSIONS.interviewRepair}

${NON_INTERACTIVE_NOTICE}

Convert the previous response to valid JSON with the shape { "questions": [ { "question", "whyItMatters", "priority" } ], "done": boolean } without adding or removing questions. priority must be "high", "medium", or "low".

PREVIOUS_RESPONSE_BEGIN
${raw}
PREVIOUS_RESPONSE_END`;
}

const DRAFT_SHAPE = `{
  "title": "proposal title",
  "background": "why this question matters and what is known, grounded in the transcript and context",
  "hypotheses": [ { "statement": "testable claim", "rationale": "why it might be true", "falsifier": "the observation that would refute it" } ],
  "experiments": [
    {
      "step": 1,
      "title": "short name",
      "method": "exactly what is done",
      "metrics": ["what is measured"],
      "successCriteria": "numeric or otherwise unambiguous",
      "killCriteria": "the result that stops this line of work",
      "resources": ["data, tools, people, compute"],
      "estimatedEffort": "for example 2 days or 3 weeks",
      "dependsOn": [step numbers this step needs]
    }
  ],
  "risks": ["what could invalidate the plan"],
  "dataNeeds": ["data that must exist or be collected"],
  "deliverables": ["what the executor hands back"],
  "openAssumptions": ["assumptions the interview did not settle"]
}`;

/** The same sealed drafting prompt goes to every provider; nothing from another provider is in it. */
export function buildProposalDraftPrompt(session: ProposalSession, packet: string): string {
  const policy = session.config.policy;
  return `${PROPOSAL_PROMPT_VERSIONS.draft}

${NON_INTERACTIVE_NOTICE}

You are one member of a research council. Write a complete, executable research proposal for the topic below, grounded in the interview transcript and the context. A single executor with repository access will carry the proposal out step by step without further questions, so every step needs a method, metrics, a success criterion, and a kill criterion a stranger could apply. Say what data must exist. Do not pad: three sharp experiments beat eight vague ones.

${dialsLine(policy)}
${noveltyForDrafts(policy)}

TOPIC
${session.topic}

${priorFindingsBlock(session.priorFindings)}INTERVIEW TRANSCRIPT
${transcript(session)}

${contextBlock(packet)}

Return JSON only:
${DRAFT_SHAPE}`;
}

export function buildProposalDraftRepairPrompt(raw: string): string {
  return `${PROPOSAL_PROMPT_VERSIONS.draftRepair}

${NON_INTERACTIVE_NOTICE}

Convert the previous response to valid JSON with exactly this shape, keeping its content:
${DRAFT_SHAPE}

PREVIOUS_RESPONSE_BEGIN
${raw}
PREVIOUS_RESPONSE_END`;
}

/** Blind critique: the draft carries no author label and the reviewer is never the author. */
export function buildProposalCritiquePrompt(
  session: ProposalSession,
  draft: ProposalDraft
): string {
  const policy = session.config.policy;
  const {
    id: _id,
    rank: _rank,
    score: _score,
    createdAt: _createdAt,
    ...visible
  } = publicDraft(draft);
  return `${PROPOSAL_PROMPT_VERSIONS.critique}

${NON_INTERACTIVE_NOTICE}

You are reviewing a research proposal drafted by another council member. You do not know who wrote it and must not guess. Judge whether an executor could carry it out and whether the result would answer the topic. Name the strongest objection and every missing step. A fatal gap is a flaw that no amount of execution fixes; leave it null when there is none.

${dialsLine(policy)}
${skepticismForCritique(policy)}

TOPIC
${session.topic}

INTERVIEW TRANSCRIPT
${transcript(session)}

PROPOSAL
${JSON.stringify(visible, null, 2)}

Return JSON only:
{
  "feasibility": 1-10,
  "rigor": 1-10,
  "clarity": 1-10,
  "completeness": 1-10,
  "killCriteriaQuality": "concrete" | "vague" | "untestable",
  "fatalGap": "the flaw, or null",
  "strongestObjection": "one paragraph",
  "missingSteps": ["steps the plan needs"],
  "suggestedChanges": ["concrete edits"],
  "verdict": "strong_accept" | "accept" | "uncertain" | "reject" | "fatal",
  "confidence": 0-1
}`;
}

export function buildProposalCritiqueRepairPrompt(raw: string): string {
  return `${PROPOSAL_PROMPT_VERSIONS.critiqueRepair}

${NON_INTERACTIVE_NOTICE}

Convert the previous critique to valid JSON with fields feasibility, rigor, clarity, completeness (numbers 1-10), killCriteriaQuality ("concrete" | "vague" | "untestable"), fatalGap (string or null), strongestObjection, missingSteps (list), suggestedChanges (list), verdict ("strong_accept" | "accept" | "uncertain" | "reject" | "fatal"), confidence (0-1). Do not soften the criticism.

PREVIOUS_RESPONSE_BEGIN
${raw}
PREVIOUS_RESPONSE_END`;
}

/**
 * Synthesis sees every public draft with its critiques (ranked, without authors or reviewers) and
 * merges them into one proposal, keeping dissenting designs as alternatives.
 */
export function buildProposalSynthesisPrompt(
  session: ProposalSession,
  drafts: ProposalDraft[],
  critiques: ProposalCritique[]
): string {
  const policy = session.config.policy;
  const material = drafts.map((draft) => ({
    ...publicDraft(draft),
    critiques: critiques
      .filter((critique) => critique.draftId === draft.id)
      .map((critique) => {
        const {
          id: _id,
          draftId: _draftId,
          createdAt: _createdAt,
          ...visible
        } = publicCritique(critique);
        return visible;
      }),
  }));
  return `${PROPOSAL_PROMPT_VERSIONS.synthesis}

${NON_INTERACTIVE_NOTICE}

You are merging the council's proposal drafts into one proposal a single executor will carry out. The drafts are ranked by their blind critiques; rank 1 is the strongest but not automatically right. Keep the best-justified design, fold in critique fixes and missing steps, and preserve any dissenting design worth keeping as a named alternative rather than discarding it. Every experiment step must keep a concrete kill criterion. Do not name or guess authors.

${dialsLine(policy)}

TOPIC
${session.topic}

INTERVIEW TRANSCRIPT
${transcript(session)}

RANKED DRAFTS WITH CRITIQUES
${JSON.stringify(material, null, 2)}

Return JSON only: the draft shape below plus "rationale" (why this merge, one paragraph) and "alternatives" (dissenting designs kept, one sentence each; empty list when none).
${DRAFT_SHAPE}`;
}

export function buildProposalSynthesisRepairPrompt(raw: string): string {
  return `${PROPOSAL_PROMPT_VERSIONS.synthesisRepair}

${NON_INTERACTIVE_NOTICE}

Convert the previous response to valid JSON with the proposal shape below plus "rationale" (string) and "alternatives" (list of strings), keeping its content:
${DRAFT_SHAPE}

PREVIOUS_RESPONSE_BEGIN
${raw}
PREVIOUS_RESPONSE_END`;
}

export function buildProposalAskPrompt(
  session: ProposalSession,
  question: string,
  priorTurns: string[] = [],
  extraContext?: string
): string {
  const proposal = session.proposal ? publicProposal(session.proposal) : null;
  const drafts = session.drafts.map((draft) => publicDraft(draft));
  return `${PROPOSAL_PROMPT_VERSIONS.ask}

${NON_INTERACTIVE_NOTICE}

Answer the user's question using the persisted proposal session below. Distinguish what the interview recorded, what the council inferred, and what remains an open assumption. This chat is explanatory only: do not claim to change the proposal or run anything.

SESSION
${JSON.stringify(
  {
    id: session.id,
    topic: session.topic,
    status: session.status,
    stage: session.stage,
    transcript: transcript(session),
    proposal,
    drafts,
  },
  null,
  2
)}

PRIOR_CHAT
${priorTurns.slice(-6).join('\n') || '(none)'}
${extraContext ? `\nUSER-PROVIDED CONTEXT (files the user attached to this question)\n${extraContext}\n` : ''}
USER QUESTION
${question}`;
}

export interface ExecutorPromptInput {
  session: ProposalSession;
  repositoryPath: string;
  proposalMarkdown: string;
  transcriptMarkdown: string;
  contextPaths: string[];
}

/**
 * The prompt a single executor receives. It asks for a report between fixed delimiters so the
 * handoff runner can extract it from an interactive CLI's output.
 */
export function buildExecutorPrompt(input: ExecutorPromptInput): string {
  const { session, repositoryPath, proposalMarkdown, transcriptMarkdown, contextPaths } = input;
  const files =
    contextPaths.length > 0
      ? contextPaths.map((path) => `- ${path}`).join('\n')
      : '- (no context files were attached; work from the repository)';
  return `${PROPOSAL_PROMPT_VERSIONS.handoff}

You are the executor for research proposal ${session.id}. Carry the proposal out in the repository at ${repositoryPath}, step by step, in the order given, without asking questions: where the proposal is silent, choose the most conservative reading, record the assumption, and continue. Apply each step's kill criterion honestly; when a step is killed, stop that line, say why, and continue with steps that do not depend on it.

Rules:
- Do not modify files outside the repository. Keep experiment scripts, data snapshots, and results under a directory named hc-results/${session.id}/ inside the repository.
- Prefer measurements over recollection. Every number in the report must come from something you ran or read during this session.
- Never fabricate data, citations, or results. Report a step you could not complete as not completed, with the reason.

TOPIC
${session.topic}

CONTEXT FILES THE COUNCIL SAW (repository-relative)
${files}

PROPOSAL
${proposalMarkdown.trim()}

INTERVIEW TRANSCRIPT
${transcriptMarkdown.trim()}

When every step is finished or killed, print a final report between these exact delimiter lines and nothing after the closing line:
${EXECUTOR_REPORT_BEGIN}
# Executor report for ${session.id}
## Summary
## Per-step results (status, measurements, kill criterion applied)
## Hypothesis verdicts (supported / refuted / undetermined, with the evidence)
## Assumptions made
## Artifacts (paths under hc-results/${session.id}/)
## Open problems
${EXECUTOR_REPORT_END}`;
}

/** The executor's report, when the delimiters are present in its output. */
export function extractExecutorReport(output: string): string | undefined {
  const start = output.lastIndexOf(EXECUTOR_REPORT_BEGIN);
  if (start < 0) return undefined;
  const bodyStart = start + EXECUTOR_REPORT_BEGIN.length;
  const end = output.indexOf(EXECUTOR_REPORT_END, bodyStart);
  const body = end < 0 ? output.slice(bodyStart) : output.slice(bodyStart, end);
  return body.trim() || undefined;
}
