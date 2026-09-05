#!/usr/bin/env node

import { ResearchSessionStore } from '../research/store.js';
import { createDefaultDependencies } from './dependencies.js';
import { executeCommand, reportError } from './main.js';

const deps = createDefaultDependencies();
const store = new ResearchSessionStore();
executeCommand(process.argv.slice(2), store, deps)
  .then((code) => {
    if (code !== 0) process.exitCode = code;
  })
  .catch((error: unknown) => {
    reportError(deps.io, error);
    process.exitCode = 1;
  });
