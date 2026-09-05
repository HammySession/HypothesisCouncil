import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { CommandResult, CommandRunner } from '../../src/cli/model-discovery.js';

/**
 * Vendor listing shapes captured from real installations (ids only; every credential-like field
 * carries an obviously fake value so tests can prove it is never copied).
 */

export const CODEX_CATALOG = {
  fetched_at: '2026-09-04T10:00:00Z',
  etag: 'W/"fixture"',
  client_version: '0.120.0',
  models: [
    {
      slug: 'gpt-reserve',
      display_name: 'Reserve',
      visibility: 'hide',
      priority: 3,
      upgrade: null,
      context_window: 400000,
      supported_reasoning_levels: [],
    },
    {
      slug: 'gpt-5.6-sol',
      display_name: 'GPT-5.6 Sol',
      visibility: 'list',
      priority: 6,
      upgrade: null,
      context_window: 272000,
      max_context_window: 272000,
      supported_reasoning_levels: [
        { effort: 'low' },
        { effort: 'medium' },
        { effort: 'high' },
        { effort: 'xhigh' },
      ],
    },
    {
      slug: 'gpt-5.6-terra',
      display_name: 'GPT-5.6 Terra',
      visibility: 'list',
      priority: 7,
      upgrade: null,
      context_window: 272000,
      supported_reasoning_levels: [{ effort: 'high' }],
    },
    {
      slug: 'gpt-5.6-luna',
      display_name: 'GPT-5.6 Luna',
      visibility: 'list',
      priority: 8,
      upgrade: null,
      context_window: 272000,
      supported_reasoning_levels: [{ effort: 'high' }],
    },
    {
      slug: 'gpt-5.5',
      display_name: 'GPT-5.5',
      visibility: 'list',
      priority: 12,
      upgrade: null,
      context_window: 272000,
      supported_reasoning_levels: [{ effort: 'high' }],
    },
    {
      slug: 'gpt-5.4',
      display_name: 'GPT-5.4',
      visibility: 'list',
      priority: 16,
      upgrade: { model: 'gpt-5.6-terra' },
      context_window: 272000,
      supported_reasoning_levels: [{ effort: 'high' }],
    },
    {
      slug: 'gpt-5.4-mini',
      display_name: 'GPT-5.4 Mini',
      visibility: 'list',
      priority: 23,
      upgrade: { model: 'gpt-5.6-luna' },
      context_window: 272000,
      supported_reasoning_levels: [{ effort: 'medium' }],
    },
    {
      slug: 'gpt-5.3-codex-spark',
      display_name: 'Codex Spark',
      visibility: 'list',
      priority: 26,
      upgrade: null,
      context_window: 128000,
      supported_reasoning_levels: [{ effort: 'medium' }],
    },
    {
      slug: 'codex-auto-review',
      display_name: 'Auto review',
      visibility: 'hide',
      priority: 43,
      upgrade: null,
      context_window: 272000,
      supported_reasoning_levels: [],
    },
  ],
};

export const GROK_CACHE = {
  fetched_at: '2026-09-04T10:00:00Z',
  grok_version: '1.2.3',
  auth_method: 'FAKE-AUTH-METHOD',
  origin: 'https://example.invalid',
  etag: 'fixture',
  models: {
    'grok-4.6': {
      info: {
        id: 'grok-4.6',
        name: 'Grok 4.6',
        context_window: 500000,
        hidden: false,
        reasoning_efforts: [{ id: 'xhigh' }, { id: 'high' }, { id: 'medium' }, { id: 'low' }],
      },
      api_key: 'FAKE-GROK-API-KEY-DO-NOT-COPY',
      env_key: 'FAKE_ENV_KEY',
      api_base_url: 'https://example.invalid/v1',
    },
    'grok-4.5': {
      info: {
        id: 'grok-4.5',
        name: 'Grok 4.5',
        context_window: 256000,
        hidden: false,
        reasoning_efforts: [{ id: 'high' }],
      },
      api_key: 'FAKE-GROK-API-KEY-DO-NOT-COPY',
      env_key: 'FAKE_ENV_KEY',
      api_base_url: 'https://example.invalid/v1',
    },
    'grok-code-fast-1': {
      info: {
        id: 'grok-code-fast-1',
        name: 'Grok Code Fast',
        context_window: 256000,
        hidden: true,
        reasoning_efforts: [],
      },
      api_key: 'FAKE-GROK-API-KEY-DO-NOT-COPY',
      env_key: 'FAKE_ENV_KEY',
      api_base_url: 'https://example.invalid/v1',
    },
  },
};

export const GROK_MODELS_TEXT = [
  'You are logged in as fixture@example.invalid',
  'Default model: grok-4.6',
  '',
  'Available models:',
  '  * grok-4.6 (default)',
  '  - grok-4.5',
  '',
].join('\n');

export const AGY_MODELS_TEXT = [
  'Fetching available models...',
  'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
  'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)',
  'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
  'gemini-3.7-flash-high\tGemini 3.7 Flash (High)',
  'gemini-3.6-flash-high\tGemini 3.6 Flash (High)',
  'gemini-3.1-pro-high\tGemini 3.1 Pro (High)',
  'gemini-3.1-pro-low\tGemini 3.1 Pro (Low)',
  'claude-sonnet-4-6\tClaude Sonnet 4.6',
  'claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)',
  'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
  '',
].join('\n');

export const CLAUDE_JSON = {
  numStartups: 3,
  oauthAccount: {
    accountUuid: 'FAKE-ACCOUNT-DO-NOT-COPY',
    emailAddress: 'fixture@example.invalid',
  },
  additionalModelOptionsCache: [
    { value: 'claude-fable-5-1[1m]', label: 'Fable', description: 'Most capable, 1M context' },
  ],
};

export const CLAUDE_SETTINGS = { model: 'fable[1m]' };

export const AGY_IDS = AGY_MODELS_TEXT.split('\n')
  .filter((line) => line.includes('\t'))
  .map((line) => line.split('\t')[0]);

export const CODEX_IDS = CODEX_CATALOG.models.map((model) => model.slug);

export interface VendorHome {
  home: string;
  codexCachePath: string;
  grokCachePath: string;
  claudeJsonPath: string;
  claudeSettingsPath: string;
}

/** Write the vendor cache and config files a real machine would have under `home`. */
export function writeVendorHome(
  home: string,
  files: Partial<Record<'codex' | 'grok' | 'claude', boolean>> = {
    codex: true,
    grok: true,
    claude: true,
  }
): VendorHome {
  const codexCachePath = join(home, '.codex', 'models_cache.json');
  const grokCachePath = join(home, '.grok', 'models_cache.json');
  const claudeJsonPath = join(home, '.claude.json');
  const claudeSettingsPath = join(home, '.claude', 'settings.json');
  if (files.codex) {
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(codexCachePath, JSON.stringify(CODEX_CATALOG));
  }
  if (files.grok) {
    mkdirSync(join(home, '.grok'), { recursive: true });
    writeFileSync(grokCachePath, JSON.stringify(GROK_CACHE));
  }
  if (files.claude) {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(claudeJsonPath, JSON.stringify(CLAUDE_JSON));
    writeFileSync(claudeSettingsPath, JSON.stringify(CLAUDE_SETTINGS));
  }
  return { home, codexCachePath, grokCachePath, claudeJsonPath, claudeSettingsPath };
}

export interface FakeRunner {
  run: CommandRunner;
  calls: Array<{ command: string; args: string[] }>;
}

/** A runner that answers the read-only listing commands from fixtures and records every call. */
export function createFakeRunner(
  overrides: Partial<Record<'codex' | 'grok' | 'agy', string | Error>> = {}
): FakeRunner {
  const calls: FakeRunner['calls'] = [];
  const outputs: Record<string, string | Error> = {
    codex: JSON.stringify(CODEX_CATALOG),
    grok: GROK_MODELS_TEXT,
    agy: AGY_MODELS_TEXT,
    ...overrides,
  };
  const run: CommandRunner = (command, args) => {
    calls.push({ command, args });
    const key = command.replace(/^.*[\\/]/, '').replace(/\.(?:cmd|exe|bat)$/i, '');
    const output = outputs[key];
    if (output === undefined) return Promise.reject(new Error(`unexpected command ${command}`));
    if (output instanceof Error) return Promise.reject(output);
    const result: CommandResult = { stdout: output, stderr: '', code: 0 };
    return Promise.resolve(result);
  };
  return { run, calls };
}
