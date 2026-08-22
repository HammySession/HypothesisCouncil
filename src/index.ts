#!/usr/bin/env node

import { HypothesisCouncilServer } from './server.js';

const server = new HypothesisCouncilServer();
let stopping = false;

async function stop(exitCode: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  try {
    await server.stop();
  } finally {
    process.exitCode = exitCode;
  }
}

process.once('SIGINT', () => void stop(0));
process.once('SIGTERM', () => void stop(0));

server.start().catch((error: unknown) => {
  process.stderr.write(
    `Hypothesis Council failed to start: ${error instanceof Error ? error.message : String(error)}\n`
  );
  void stop(1);
});
