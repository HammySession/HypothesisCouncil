#!/usr/bin/env node

import { parseStdinShimArguments, runStdinShim } from './stdin-shim-core.js';

async function main(): Promise<void> {
  const invocation = parseStdinShimArguments(process.argv.slice(2));
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const prompt = Buffer.concat(chunks).toString('utf8');
  process.exitCode = await runStdinShim(invocation, prompt, {
    cwd: process.cwd(),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`stdin-shim: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
