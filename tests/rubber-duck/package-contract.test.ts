import { chmodSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { McpRubberDuckClient } from '../../src/rubber-duck/client.js';
import { createSdkMcpPeer } from '../../src/rubber-duck/peer.js';

describe('installed Rubber Duck package contract', () => {
  it('starts the pinned MCP executable and calls a configured local fake provider', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hc-rubber-duck-contract-'));
    const fakeCli = join(home, 'fake-cli.mjs');
    writeFileSync(
      fakeCli,
      "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('contract response'));\n",
      'utf8'
    );
    const client = new McpRubberDuckClient(
      createSdkMcpPeer(home, {
        environment: {
          HOME: home,
          PATH: process.env.PATH,
          LOG_LEVEL: 'error',
          NODE_ENV: 'test',
          CLI_CUSTOM_CONTRACT_COMMAND: process.execPath,
          CLI_CUSTOM_CONTRACT_CLI_ARGS: fakeCli,
          CLI_CUSTOM_CONTRACT_PROMPT_DELIVERY: 'stdin',
          CLI_CUSTOM_CONTRACT_OUTPUT_FORMAT: 'text',
          CLI_CUSTOM_CONTRACT_NICKNAME: 'Contract Duck',
        },
      })
    );

    try {
      await expect(client.listProviders()).resolves.toEqual([
        {
          name: 'cli-contract',
          nickname: 'Contract Duck',
          model: 'cli',
          type: 'cli',
        },
      ]);
      await expect(client.ask('cli-contract', 'contract prompt')).resolves.toEqual({
        content: 'contract response',
        model: 'cli',
      });
    } finally {
      await client.close();
    }
  });

  it('adapts the installed default Codex preset to its current stdin contract', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hc-rubber-duck-codex-contract-'));
    const fakeCodex = join(home, 'codex');
    writeFileSync(
      fakeCodex,
      `#!${process.execPath}\nlet input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { if (process.argv.includes('--full-auto') || input !== 'contract prompt') process.exit(2); process.stdout.write('codex stdin response'); });\n`,
      'utf8'
    );
    chmodSync(fakeCodex, 0o755);
    const client = new McpRubberDuckClient(
      createSdkMcpPeer(home, {
        codexModel: 'gpt-5.6-sol',
        environment: {
          HOME: home,
          PATH: `${home}:${process.env.PATH || ''}`,
          LOG_LEVEL: 'error',
          NODE_ENV: 'test',
          CLI_CODEX_ENABLED: 'true',
        },
      })
    );

    try {
      await expect(client.listProviders()).resolves.toEqual([
        {
          name: 'cli-codex',
          nickname: 'CODEX Agent',
          model: 'gpt-5.6-sol',
          type: 'cli',
        },
      ]);
      await expect(client.ask('cli-codex', 'contract prompt')).resolves.toEqual({
        content: 'codex stdin response',
        model: 'gpt-5.6-sol',
      });
    } finally {
      await client.close();
    }
  });

  it('adapts the installed default Claude preset to stdin and parses its JSON result', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hc-rubber-duck-claude-contract-'));
    const fakeClaude = join(home, 'claude');
    writeFileSync(
      fakeClaude,
      `#!${process.execPath}\nlet input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => { if (!process.argv.includes('-p') || input !== 'contract prompt') process.exit(2); process.stdout.write(JSON.stringify({result:'claude stdin response'})); });\n`,
      'utf8'
    );
    chmodSync(fakeClaude, 0o755);
    const client = new McpRubberDuckClient(
      createSdkMcpPeer(home, {
        environment: {
          HOME: home,
          PATH: `${home}:${process.env.PATH || ''}`,
          LOG_LEVEL: 'error',
          NODE_ENV: 'test',
          CLI_CLAUDE_ENABLED: 'true',
        },
      })
    );

    try {
      await expect(client.listProviders()).resolves.toEqual([
        {
          name: 'cli-claude',
          nickname: 'CLAUDE Agent',
          model: 'cli',
          type: 'cli',
        },
      ]);
      await expect(client.ask('cli-claude', 'contract prompt')).resolves.toEqual({
        content: 'claude stdin response',
        model: 'cli',
      });
    } finally {
      await client.close();
    }
  });
});
