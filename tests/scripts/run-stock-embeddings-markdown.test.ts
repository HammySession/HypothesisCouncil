import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';

describe('run-stock-embeddings-markdown.sh', () => {
  it('pins all four profiles and requests only Markdown context from the repository', () => {
    const root = mkdtempSync(join(tmpdir(), 'hc-stock-script-'));
    const bin = join(root, 'bin');
    const repository = join(root, 'stock_embeddings');
    const capture = join(root, 'capture.txt');
    mkdirSync(bin);
    mkdirSync(repository);
    writeFileSync(join(repository, 'README.md'), '# Stock embeddings');

    for (const command of ['agy', 'claude', 'codex', 'grok']) {
      const path = join(bin, command);
      writeFileSync(path, '#!/bin/sh\nexit 0\n');
      chmodSync(path, 0o755);
    }
    const fakeHc = join(bin, 'hc');
    writeFileSync(
      fakeHc,
      `#!/bin/sh\n{
printf 'ARGS=%s\\n' "$*"
printf 'TIMEOUT=%s|%s|%s\\n' "$HYPOTHESIS_COUNCIL_PROVIDER_TIMEOUT_MS" "$CLI_CUSTOM_AGY_PROCESS_TIMEOUT" "$CLI_CUSTOM_GROK_PROCESS_TIMEOUT"
printf 'AGY=%s|%s|%s\\n' "$CLI_CUSTOM_AGY_COMMAND" "$CLI_CUSTOM_AGY_DEFAULT_MODEL" "$CLI_CUSTOM_AGY_CLI_ARGS"
printf 'CLAUDE=%s|%s\\n' "$CLI_CLAUDE_ENABLED" "$CLI_CLAUDE_DEFAULT_MODEL"
printf 'CODEX=%s|%s|%s\\n' "$CLI_CODEX_ENABLED" "$CLI_CODEX_DEFAULT_MODEL" "$HYPOTHESIS_COUNCIL_CODEX_REASONING_EFFORT"
printf 'GROK=%s|%s|%s\\n' "$CLI_CUSTOM_GROK_COMMAND" "$CLI_CUSTOM_GROK_DEFAULT_MODEL" "$CLI_CUSTOM_GROK_CLI_ARGS"
} > "$HC_CAPTURE"\n`,
      'utf8'
    );
    chmodSync(fakeHc, 0o755);

    const script = resolve('scripts/run-stock-embeddings-markdown.sh');
    const result = spawnSync('bash', [script, '--yes'], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        HC_CAPTURE: capture,
        STOCK_EMBEDDINGS_REPO: repository,
      },
    });

    expect(result.status).toBe(0);
    const recorded = readFileSync(capture, 'utf8');
    expect(recorded).toContain(
      `ARGS=run --repo ${repository} --markdown-only --providers cli-grok,cli-agy,cli-claude,cli-codex --min-providers 4 --yes`
    );
    expect(recorded).toContain(
      'AGY=agy|gemini-3.1-pro-high|--output-format,json,--model,gemini-3.1-pro-high,--effort,high,--sandbox'
    );
    expect(recorded).toContain('TIMEOUT=900000|900000|900000');
    expect(recorded).toContain('CLAUDE=true|claude-fable-5[1m]');
    expect(recorded).toContain('CODEX=true|gpt-5.6-sol|xhigh');
    expect(recorded).toContain('GROK=grok|grok-4.6|-m,grok-4.6,--reasoning-effort,xhigh');
  });
});
