import { argumentTransportLimitBytes } from '../research/context-budget.js';
import type { ResearchSessionStore } from '../research/store.js';
import { withCouncilRuntime } from '../runtime.js';
import { hasFlag, type ParsedArguments } from './arguments.js';
import type { CliDependencies } from './dependencies.js';
import { runDoctor, type DoctorReport } from './doctor.js';
import type { ResolvedModel } from './model-selection.js';
import { defaultPresetName, selectPreset } from './preset-selection.js';
import {
  INSTALL_HINT,
  missingPresetCommands,
  modelsByProvider,
  type CouncilPreset,
} from './presets.js';
import { resolveStoreSettings, settingsFlags } from './settings-command.js';

export interface DoctorOutcome {
  report: DoctorReport;
  preset?: CouncilPreset;
  models?: Record<string, ResolvedModel>;
}

/**
 * Shared by `hc doctor` and `/doctor`: honours `--preset` (non-strict, falling back to the
 * preset a run would use) and `--probe`. When the auto preset finds no vendor CLI, the report
 * says so without starting Rubber Duck, which could not start either.
 */
export async function executeDoctor(
  parsed: ParsedArguments,
  store: ResearchSessionStore,
  deps: CliDependencies,
  signal?: AbortSignal
): Promise<DoctorOutcome> {
  const settings = resolveStoreSettings(store, deps.env, settingsFlags(parsed));
  const selected = await selectPreset(parsed, false, deps, {
    store,
    settings,
    defaultName: defaultPresetName(settings, deps),
  });
  const preset = selected?.preset;
  if (preset && preset.providers.length === 0) {
    return {
      preset,
      report: {
        platform: deps.platform,
        nodeVersion: process.version,
        rubberDuckVersion: deps.rubberDuckVersion(),
        sessionHome: store.root,
        argumentTransportLimitBytes: argumentTransportLimitBytes(deps.platform),
        providers: [],
        problems: [
          'Nothing to check: no providers are configured. No supported AI CLI is on PATH and no Rubber Duck provider variable is set.',
        ],
        hints: [INSTALL_HINT, 'Run `hc presets` to see the ready-made councils.'],
      },
    };
  }
  const report = await withCouncilRuntime(deps.runtimeFactory(store), ({ gateway }) =>
    runDoctor({
      gateway,
      workingDirectory: store.sessionDirectory('doctor'),
      sessionHome: store.root,
      environment: deps.env,
      platform: deps.platform,
      probe: hasFlag(parsed, '--probe'),
      rubberDuckVersion: deps.rubberDuckVersion(),
      locateCommand: deps.locateCommand,
      now: deps.now,
      signal,
      models: selected ? modelsByProvider(selected.preset, selected.models) : undefined,
    })
  );
  if (preset) {
    const missing = missingPresetCommands(preset, deps.env, deps.platform, deps.locateCommand);
    for (const command of missing) {
      const message = `Preset ${preset.name} requires "${command}", which is not on PATH.`;
      if (!report.problems.includes(message)) report.problems.push(message);
    }
  }
  return { report, preset, models: selected?.models };
}
