import { existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { openQuestions } from '../../research/proposal/interview.js';
import { isProposalId, proposalStoreFor } from '../../research/proposal/store.js';
import type { ShellContext } from './context.js';
import type { ShellCommand } from './registry.js';

export type ShellCompleter = (line: string) => [string[], string];

/** Entries of a directory for path completion; `prefix` may include a directory part. */
export function completePath(prefix: string, root: string): string[] {
  const separator = Math.max(prefix.lastIndexOf('/'), prefix.lastIndexOf('\\'));
  const directoryPart = separator >= 0 ? prefix.slice(0, separator + 1) : '';
  const namePart = separator >= 0 ? prefix.slice(separator + 1) : prefix;
  const directory = resolve(root, directoryPart || '.');
  if (!existsSync(directory)) return [];
  try {
    return readdirSync(directory)
      .filter((name) => name.startsWith(namePart) && !name.startsWith('.'))
      .sort()
      .map((name) => {
        const full = join(directory, name);
        const isDirectory = statSync(full).isDirectory();
        return `${directoryPart}${name}${isDirectory ? '/' : ''}`;
      });
  } catch {
    return [];
  }
}

const SESSION_ARGUMENT_COMMANDS = new Set(['use', 'open', 'tag', 'status', 'candidates']);

function selectedProposal(ctx: ShellContext) {
  const id = ctx.state.selectedSession;
  if (!id || !isProposalId(id)) return undefined;
  try {
    return proposalStoreFor(ctx.store).load(id);
  } catch {
    return undefined;
  }
}

/**
 * Readline completion: commands after `/`, session ids after `/use`, `/open`, and `/tag`,
 * providers after `/duck` and `@`, and repository paths after `@` and `/context add`.
 */
export function createShellCompleter(
  ctx: ShellContext,
  commands: () => readonly ShellCommand[]
): ShellCompleter {
  return (line) => {
    if (line.startsWith('/') && !/\s/.test(line)) {
      const names = commands().map((command) => `/${command.name}`);
      const hits = names.filter((name) => name.startsWith(line)).sort();
      return [hits, line];
    }
    const match = line.match(/(\S*)$/);
    const word = match?.[1] ?? '';
    const words = line.trim().split(/\s+/);
    const command = words[0]?.startsWith('/') ? words[0].slice(1) : undefined;
    const argumentIndex = line.endsWith(' ') || word === '' ? words.length : words.length - 1;
    const providers = () => {
      const names = new Set(ctx.state.knownProviders);
      if (ctx.state.selectedSession) {
        try {
          const selected = isProposalId(ctx.state.selectedSession)
            ? proposalStoreFor(ctx.store).load(ctx.state.selectedSession)
            : ctx.store.load(ctx.state.selectedSession);
          for (const name of selected.providers) names.add(name);
        } catch {
          // A vanished session must not break completion.
        }
      }
      return [...names].sort();
    };
    if (word.startsWith('@')) {
      const token = word.slice(1);
      const hits = [
        ...providers().filter((name) => name.startsWith(token)),
        ...completePath(token, ctx.state.repoRoot),
      ].map((hit) => `@${hit}`);
      return [hits, word];
    }
    if (command && SESSION_ARGUMENT_COMMANDS.has(command) && argumentIndex === 1) {
      const ids = ctx.store.list().map((session) => session.id);
      const extra = command === 'open' ? ['index'] : [];
      const proposals =
        command === 'use'
          ? proposalStoreFor(ctx.store)
              .list()
              .map((session) => session.id)
          : [];
      return [[...ids, ...proposals, ...extra].filter((id) => id.startsWith(word)), word];
    }
    if ((command === 'pick' || command === 'proposal') && argumentIndex === 1) {
      const ids = selectedProposal(ctx)?.drafts.map((draft) => draft.id) ?? [];
      const extra = command === 'proposal' ? ['drafts', 'json'] : [];
      return [[...ids, ...extra].filter((id) => id.startsWith(word)), word];
    }
    if (command === 'answer' && argumentIndex === 1) {
      const proposal = selectedProposal(ctx);
      const ids = proposal ? openQuestions(proposal).map((question) => question.id) : [];
      return [ids.filter((id) => id.startsWith(word)), word];
    }
    if (command === 'handoff' && argumentIndex === 1) {
      const names = ['claude', 'codex', 'agy', 'grok'];
      return [names.filter((name) => name.startsWith(word)), word];
    }
    if (command === 'duck' && argumentIndex === 1) {
      const last = word.slice(word.lastIndexOf(',') + 1);
      const hits = [...providers(), 'all', 'auto'].filter((name) => name.startsWith(last));
      return [hits, last];
    }
    if ((command === 'context' && words[1] === 'add' && argumentIndex >= 2) || command === 'repo') {
      return [completePath(word, ctx.state.repoRoot), word];
    }
    return [[], word];
  };
}
