import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';

const script = resolve('scripts/run-stock-embeddings-markdown.mjs');

describe('run-stock-embeddings-markdown.mjs', () => {
  it('runs the frontier preset over the repository with Markdown-only context', () => {
    const root = mkdtempSync(join(tmpdir(), 'hc-stock-script-'));
    const repository = join(root, 'stock_embeddings');
    const capture = join(root, 'capture.json');
    const fakeCli = join(root, 'fake-cli.mjs');
    mkdirSync(repository);
    writeFileSync(join(repository, 'README.md'), '# Stock embeddings');
    writeFileSync(
      fakeCli,
      "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.HC_CAPTURE, JSON.stringify(process.argv.slice(2)));\n",
      'utf8'
    );

    const result = spawnSync(process.execPath, [script, '--yes'], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        HC_CAPTURE: capture,
        HYPOTHESIS_COUNCIL_CLI: fakeCli,
        STOCK_EMBEDDINGS_REPO: repository,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('Preset: frontier');
    expect(JSON.parse(readFileSync(capture, 'utf8'))).toEqual([
      'run',
      '--preset',
      'frontier',
      '--repo',
      resolve(repository),
      '--markdown-only',
      '--yes',
    ]);
  });

  it('fails clearly when the repository is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'hc-stock-script-missing-'));
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, STOCK_EMBEDDINGS_REPO: join(root, 'nowhere') },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('STOCK_EMBEDDINGS_REPO');
  });
});
