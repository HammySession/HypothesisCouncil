import { lstatSync } from 'fs';
import { dialsFromSettings } from '../research/settings.js';
import type { ResearchSessionStore } from '../research/store.js';
import type { ResearchRunPreview, ResearchSession } from '../research/types.js';
import { withCouncilRuntime } from '../runtime.js';
import {
  flagValues,
  hasFlag,
  listFlag,
  numberFlag,
  pathFlag,
  type ParsedArguments,
} from './arguments.js';
import type { CliDependencies } from './dependencies.js';
import { runPreviewLines } from './format.js';
import { describeModels, type CouncilPreset } from './presets.js';
import { selectPreset } from './preset-selection.js';
import { createRunInput } from './run-options.js';
import { resolveStoreSettings, settingsFlags } from './settings-command.js';
import type { ShellIO } from './shell/io.js';

export { selectPreset } from './preset-selection.js';

export interface RunOutcome {
  session: ResearchSession;
  elapsedMs: number;
}

export interface RunCommandOptions {
  /** The interactive shell already showed the preview; skip the confirmation prompt. */
  interactive?: boolean;
  signal?: AbortSignal;
  /** Preset selected earlier (for example with `/preset`); `--preset` on the line wins. */
  preset?: CouncilPreset;
}

export const CONTEXT_CONFIRMATION_REQUIRED =
  'Repository context is sent to external providers. Re-run with --yes after reviewing the preview, or use --dry-run to inspect it.';

export function printRunPreview(io: ShellIO, preview: ResearchRunPreview): void {
  for (const line of runPreviewLines(preview)) io.err(line);
}

export async function confirmRun(io: ShellIO, preview: ResearchRunPreview): Promise<void> {
  printRunPreview(io, preview);
  if (!io.isInteractive) throw new Error(CONTEXT_CONFIRMATION_REQUIRED);
  const approved = await io.confirm('Send this context to the selected providers?');
  if (!approved) throw new Error('Run cancelled');
}

export async function runCommand(
  parsed: ParsedArguments,
  store: ResearchSessionStore,
  deps: CliDependencies,
  options: RunCommandOptions = {}
): Promise<RunOutcome | undefined> {
  const settings = resolveStoreSettings(store, deps.env, settingsFlags(parsed));
  // Precedence for the preset: --preset on the line, then /preset in the shell, then the
  // settings default (environment variable or file).
  const defaultName = options.preset ? undefined : settings.values.defaultPreset;
  const selected = await selectPreset(parsed, true, deps, { store, settings, defaultName });
  const preset = selected?.preset ?? options.preset;
  const repositoryPath = pathFlag(parsed, '--repo');
  const explicitContext = flagValues(parsed, '--context');
  const input = createRunInput(
    {
      goalParts: parsed.positionals,
      contextPaths:
        explicitContext.length > 0 ? explicitContext : (settings.values.defaultContext ?? []),
      repositoryPath,
      providers: listFlag(parsed, '--providers') ?? preset?.providers,
      hypothesesPerProvider: numberFlag(parsed, '--hypotheses'),
      topK: numberFlag(parsed, '--top-k'),
      minProviders:
        numberFlag(parsed, '--min-providers') ??
        (hasFlag(parsed, '--allow-single') ? 1 : preset?.minProviders),
      seed: numberFlag(parsed, '--seed'),
      maxContextBytes: numberFlag(parsed, '--max-context-bytes'),
      markdownOnly: settings.values.markdownOnly,
      dials: dialsFromSettings(settings),
      // Sources settings resolve like the dials: --sources/--scouts/--web on the line, then the
      // environment, then the settings file. `auto` leaves the service to decide (web on).
      sourcesFile: settings.values.sources.file,
      scouts: settings.values.sources.scouts,
      web: settings.values.sources.web === 'auto' ? undefined : settings.values.sources.web,
      meta: preset ? { preset: preset.name } : undefined,
    },
    deps.cwd
  );
  try {
    if (!input.contextRoot || !lstatSync(input.contextRoot).isDirectory()) throw new Error();
  } catch {
    throw new Error(`Repository directory not found: ${input.contextRoot || repositoryPath}`);
  }
  if (preset) deps.io.err(`Preset: ${preset.name}`);
  if (selected && preset?.modelSlots?.length) {
    deps.io.err(`Models: ${describeModels(preset, selected.models)}`);
  }

  if (hasFlag(parsed, '--dry-run')) {
    const preview = await withCouncilRuntime(deps.runtimeFactory(store), ({ service }) =>
      service.preview(input, options.signal)
    );
    printRunPreview(deps.io, preview);
    deps.io.err('Dry run: no session was created and nothing was sent to a provider.');
    return undefined;
  }

  const automaticallyApproved = options.interactive || hasFlag(parsed, '--yes');
  const renderer = deps.createProgressRenderer();
  const startedAt = deps.now();
  try {
    const session = await withCouncilRuntime(deps.runtimeFactory(store), ({ service }) =>
      service.run(input, renderer.handle, options.signal, async (preview) => {
        if (automaticallyApproved) printRunPreview(deps.io, preview);
        else await confirmRun(deps.io, preview);
      })
    );
    return { session, elapsedMs: deps.now() - startedAt };
  } finally {
    renderer.finish();
  }
}
