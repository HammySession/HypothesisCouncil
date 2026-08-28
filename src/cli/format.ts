import type {
  HypothesisCandidate,
  ResearchRunPreview,
  ResearchSession,
} from '../research/types.js';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/** Accepts `H-001`, `h-1`, `H1`, or `1` and returns the canonical candidate id. */
export function normalizeCandidateId(value: string): string {
  const match = value.trim().match(/^(?:h-?)?0*(\d+)$/i);
  if (!match) return value.trim();
  return `H-${match[1].padStart(3, '0')}`;
}

export function stageLabel(session: ResearchSession): string {
  if (session.status === 'failed') return 'NEEDS ATTENTION';
  if (session.status === 'interrupted') return 'INTERRUPTED';
  if (session.status === 'completed') return 'COMPLETE';
  return session.stage.toUpperCase();
}

export function orderedCandidates(session: ResearchSession): HypothesisCandidate[] {
  return session.candidates
    .filter((candidate) => candidate.status === 'distinct')
    .sort((left, right) => (left.rank || 999) - (right.rank || 999));
}

export function statusText(session: ResearchSession): string {
  const distinct = session.candidates.filter((candidate) => candidate.status === 'distinct').length;
  const packetBytes = session.contextManifest.packetBytes ?? session.contextManifest.includedBytes;
  const lines = [
    `${session.id}  ${stageLabel(session)}`,
    `Goal: ${session.goal}`,
    `Providers: ${session.providers.length}/${session.config.providers.length} ready`,
    `Context: ${formatBytes(packetBytes)}/${formatBytes(session.config.maxContextBytes)}${session.config.markdownOnly ? ' · Markdown only' : ''}`,
    `Candidates: ${session.candidates.length} raw | ${distinct} distinct | ${session.reviews.length} reviewed | ${session.falsifications.length} falsified`,
  ];
  if (session.stage === 'generating' && session.candidates.length === 0) {
    lines.push('Candidates are sealed until independent generation completes.');
  }
  if (session.warnings.length > 0) {
    lines.push(`Warnings (${session.warnings.length}):`);
    for (const warning of session.warnings) lines.push(`  - ${warning}`);
  }
  if (session.reportMarkdownPath) lines.push(`Report: ${session.reportMarkdownPath}`);
  if (session.error) lines.push(`Error: ${session.error}`);
  return lines.join('\n');
}

export function candidatesText(session: ResearchSession): string {
  if (session.candidates.length === 0) {
    return 'Candidates are sealed until independent generation completes.';
  }
  const rows = orderedCandidates(session).map((candidate) => {
    const rank = candidate.rank ? `${candidate.rank}.` : '—';
    const score = candidate.score === undefined ? 'pending' : candidate.score.toFixed(2);
    const verdict = session.reviews.find((review) => review.hypothesisId === candidate.id)?.verdict;
    return `${rank.padEnd(4)} ${candidate.id.padEnd(6)} ${candidate.title}  [review ${score}${verdict ? ` · ${verdict}` : ''}]`;
  });
  return [`Candidates for ${session.id}`, ...rows].join('\n');
}

export function candidateText(session: ResearchSession, candidateId: string): string {
  const candidate = session.candidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error(`Candidate not found: ${candidateId}`);
  const review = session.reviews.find((item) => item.hypothesisId === candidate.id);
  const attack = session.falsifications.find((item) => item.hypothesisId === candidate.id);
  return [
    `${candidate.id} — ${candidate.title}`,
    `Status: ${candidate.status}${candidate.duplicateOf ? ` of ${candidate.duplicateOf}` : ''}`,
    `Claim: ${candidate.claim}`,
    `Mechanism: ${candidate.mechanism}`,
    `Predictions: ${candidate.predictions.join('; ')}`,
    `Assumptions: ${candidate.assumptions.join('; ') || 'None recorded'}`,
    `Falsifier: ${candidate.falsifier}`,
    `Minimal experiment: ${candidate.minimalExperiment}`,
    `Review: ${review?.verdict || 'pending'}${review ? ` — ${review.strongestObjection}` : ''}`,
    `Adversarial attack: ${attack?.competingExplanation || 'not selected/pending'}`,
  ].join('\n');
}

export function runPreviewLines(preview: ResearchRunPreview): string[] {
  const manifest = preview.contextManifest;
  const limit = preview.contextBudget.providerLimits.find(
    (provider) => provider.provider === preview.contextBudget.limitingProvider
  );
  const calls = preview.plannedCalls;
  const lines = [
    `Goal: ${preview.goal}`,
    `Repository: ${preview.contextRoot}`,
    `Providers: ${preview.providers.join(', ')} (at least ${preview.minProviders} must be ready)`,
    `Context mode: ${preview.markdownOnly ? 'Markdown files only' : 'supported text and code files'}`,
    `Shared context budget: ${formatBytes(preview.contextBudget.maxBytes)}; limited by ${preview.contextBudget.limitingProvider}${limit ? ` (${limit.model}, ${limit.contextWindowTokens.toLocaleString()} tokens${limit.transportLimited ? ', argument transport' : ''})` : ''}`,
    `Context preview: ${manifest.files.length} files contribute ${formatBytes(manifest.includedBytes)}; packet ${formatBytes(manifest.packetBytes)}/${formatBytes(manifest.maxBytes)}; denied ${manifest.deniedPaths.length}; omitted ${manifest.omittedPaths.length}`,
    `Planned provider calls: ${calls.total} (${calls.generation} generation × ${preview.hypothesesPerProvider} hypotheses, up to ${calls.review} reviews, ${calls.falsification} falsifications), plus repairs and retries when needed`,
  ];
  for (const file of manifest.files.slice(0, 20)) {
    lines.push(
      `  include ${file.path}${file.truncated ? ` (${formatBytes(file.includedBytes)} excerpt)` : ''}`
    );
  }
  if (manifest.files.length > 20) {
    lines.push(`  ...     ${manifest.files.length - 20} more included files`);
  }
  for (const path of manifest.deniedPaths.slice(0, 20)) lines.push(`  deny    ${path}`);
  if (manifest.deniedPaths.length > 20) {
    lines.push(`  ...     ${manifest.deniedPaths.length - 20} more denied paths`);
  }
  return lines;
}

export interface RunSummaryOptions {
  elapsedMs?: number;
  copiedReportPath?: string;
  topN?: number;
}

export function runSummaryText(session: ResearchSession, options: RunSummaryOptions = {}): string {
  const top = orderedCandidates(session).slice(0, options.topN ?? 3);
  const lines = [
    `${session.id}  ${stageLabel(session)}${options.elapsedMs === undefined ? '' : ` · ${formatDuration(options.elapsedMs)}`}`,
    `Goal: ${session.goal}`,
  ];
  if (top.length > 0) {
    lines.push('Top candidates:');
    for (const candidate of top) {
      const review = session.reviews.find((item) => item.hypothesisId === candidate.id);
      const score = candidate.score === undefined ? 'pending' : candidate.score.toFixed(2);
      lines.push(
        `  ${candidate.rank ?? '—'}. ${candidate.id}  ${candidate.title}  [review ${score}${review ? ` · ${review.verdict}` : ''}]`
      );
    }
  } else if (session.candidates.length === 0) {
    lines.push('Candidates are sealed until independent generation completes.');
  }
  if (session.warnings.length > 0) {
    lines.push(`Warnings: ${session.warnings.length} (run \`hc status\` to read them)`);
  }
  if (session.reportMarkdownPath) lines.push(`Report: ${session.reportMarkdownPath}`);
  if (options.copiedReportPath) lines.push(`Report copied to: ${options.copiedReportPath}`);
  if (session.error) lines.push(`Error: ${session.error}`);
  if (top.length > 0) {
    lines.push(
      `Next: hc show ${top[0].id} · hc ask "Which experiment best separates the finalists?" · hc report`
    );
  }
  return lines.join('\n');
}

/** Actionable follow-ups for common failures, appended below the error message. */
export function errorHints(message: string): string[] {
  const hints: string[] = [];
  if (/No Rubber Duck provider|Unable to start the installed Rubber Duck/i.test(message)) {
    hints.push(
      'Run `hc doctor` to inspect provider configuration, or `hc presets` to pick a ready-made council.'
    );
  }
  if (/Preflight found \d+ usable providers|providers produced valid hypotheses/i.test(message)) {
    hints.push('Run `hc doctor --probe` to see which providers answer and why others fail.');
  }
  if (/No current research session|Research session not found/i.test(message)) {
    hints.push('Run `hc run` to start a session, or `hc sessions` to list existing ones.');
  }
  if (/Unknown preset/i.test(message)) hints.push('Run `hc presets` to list available presets.');
  return hints;
}
