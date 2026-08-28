#!/usr/bin/env node
// Runs the four-model "frontier" council over the sibling stock_embeddings repository using only
// its Markdown/MDX files. Works from PowerShell, cmd, and POSIX shells alike.
//
//   npm run stock:markdown -- --yes
//   STOCK_EMBEDDINGS_REPO=/absolute/path npm run stock:markdown
//
// The provider profiles live in the `frontier` preset (see `hc presets`); this script only picks
// the repository and the Markdown-only context mode.

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(
  process.env.STOCK_EMBEDDINGS_REPO || resolve(projectDirectory, '..', 'stock_embeddings')
);

if (!existsSync(repository) || !statSync(repository).isDirectory()) {
  process.stderr.write(
    `stock_embeddings repository not found: ${repository}\nSet STOCK_EMBEDDINGS_REPO to its absolute path.\n`
  );
  process.exit(1);
}

const cli =
  process.env.HYPOTHESIS_COUNCIL_CLI ||
  resolve(projectDirectory, 'dist', 'cli', 'hypothesis-council.js');
if (!existsSync(cli)) {
  process.stderr.write(
    `Hypothesis Council is not built (${cli} is missing). Run 'npm run build'.\n`
  );
  process.exit(1);
}

process.stderr.write(
  `Repository: ${repository}\nContext: Markdown and MDX only\nPreset: frontier\n`
);

const result = spawnSync(
  process.execPath,
  [
    cli,
    'run',
    '--preset',
    'frontier',
    '--repo',
    repository,
    '--markdown-only',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', env: process.env }
);
process.exit(result.status ?? 1);
