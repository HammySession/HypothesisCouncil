import type { ShellCommand } from '../registry.js';
import { askAllCommand } from './ask-all.js';
import { candidatesCommand } from './candidates.js';
import { clearCommand } from './clear.js';
import { contextCommand } from './context.js';
import { doctorCommand } from './doctor.js';
import { duckCommand } from './duck.js';
import { exitCommand } from './exit.js';
import { createHelpCommand } from './help.js';
import { modelsCommand } from './models.js';
import { openCommand } from './open.js';
import { presetCommand } from './preset.js';
import { presetsCommand } from './presets.js';
import {
  answerCommand,
  doneCommand,
  draftCommand,
  handoffCommand,
  nextCommand,
  pickCommand,
  proposalCommand,
  proposalsCommand,
  questionsCommand,
} from './proposal-flow.js';
import { proposeCommand } from './propose.js';
import { repoCommand } from './repo.js';
import { reportCommand } from './report.js';
import { reportsCommand } from './reports.js';
import { resumeCommand } from './resume.js';
import { runShellCommand } from './run.js';
import { sessionsCommand } from './sessions.js';
import { setCommand } from './set.js';
import { settingsCommand } from './settings.js';
import { showCommand } from './show.js';
import { statusCommand } from './status.js';
import { summarizeCommand } from './summarize.js';
import { tagCommand } from './tag.js';
import { unsetCommand } from './unset.js';
import { useCommand } from './use.js';

/** Every interactive command, in `/help` order. */
export const SHELL_COMMANDS: readonly ShellCommand[] = [
  runShellCommand,
  repoCommand,
  contextCommand,
  presetCommand,
  presetsCommand,
  modelsCommand,
  settingsCommand,
  setCommand,
  unsetCommand,
  doctorCommand,
  statusCommand,
  candidatesCommand,
  showCommand,
  useCommand,
  duckCommand,
  askAllCommand,
  clearCommand,
  resumeCommand,
  reportCommand,
  reportsCommand,
  openCommand,
  tagCommand,
  summarizeCommand,
  sessionsCommand,
  proposeCommand,
  questionsCommand,
  answerCommand,
  nextCommand,
  doneCommand,
  draftCommand,
  pickCommand,
  proposalCommand,
  proposalsCommand,
  handoffCommand,
  createHelpCommand(() => SHELL_COMMANDS),
  exitCommand,
];
