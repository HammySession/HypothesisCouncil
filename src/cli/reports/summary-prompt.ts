import { createPublicReport } from '../../research/report.js';
import type { ResearchSession } from '../../research/types.js';

export const SUMMARY_PROMPT_VERSION = 'report-summary:v1';

/**
 * One call that turns the public report into a two-sentence summary for the catalog. It is built
 * from the public report, so reviewer and author identities never reach the summarising model.
 */
export function buildSummaryPrompt(session: ResearchSession): string {
  return `${SUMMARY_PROMPT_VERSION}

Summarise the research report below in at most two plain sentences (under 60 words) for a catalog card: the goal and the strongest surviving hypothesis with its review outcome. Do not add claims that are not in the report. Reply with the summary only.

REPORT
${JSON.stringify(createPublicReport(session), null, 2)}`;
}

/** Collapse whitespace and cap the stored summary. */
export function normalizeSummary(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 400);
}
