import {
  agyArgs,
  assertCodexReasoningEffort,
  claudeArgs,
  codexArgs,
  grokArgs,
  webAccessFromArgs,
} from '../../src/rubber-duck/vendor-args.js';

describe('vendor argument builders', () => {
  it('builds council Claude arguments with no tools and scout arguments with only web tools', () => {
    const council = claudeArgs({ model: 'claude-x' });
    expect(council).toEqual([
      '-p',
      '--output-format',
      'json',
      '--max-turns',
      '3',
      '--no-session-persistence',
      '--permission-mode',
      'dontAsk',
      '--model',
      'claude-x',
      '--strict-mcp-config',
      '--tools',
      '',
    ]);
    const scout = claudeArgs({ maxTurns: 12, tools: ['WebSearch', 'WebFetch'], restricted: true });
    expect(scout.slice(scout.indexOf('--restricted'))).toEqual([
      '--restricted',
      '--strict-mcp-config',
      '--tools',
      'WebSearch',
      'WebFetch',
      '--allowedTools',
      'WebSearch',
      'WebFetch',
    ]);
    expect(scout).toContain('12');
    expect(scout).not.toContain('--model');
  });

  it('builds Codex arguments with reasoning effort and config overrides', () => {
    expect(codexArgs()).toEqual([
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--color',
      'never',
      '-',
    ]);
    expect(
      codexArgs({ model: 'gpt-x', reasoningEffort: 'high', configOverrides: ['web_search="live"'] })
    ).toEqual([
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--color',
      'never',
      '--model',
      'gpt-x',
      '-c',
      'model_reasoning_effort="high"',
      '-c',
      'web_search="live"',
      '-',
    ]);
    expect(() => codexArgs({ reasoningEffort: 'ultra' })).toThrow(
      'HYPOTHESIS_COUNCIL_CODEX_REASONING_EFFORT'
    );
    expect(assertCodexReasoningEffort('xhigh')).toBe('xhigh');
  });

  it('builds Grok and AGY arguments', () => {
    expect(grokArgs({ model: 'grok-4', reasoningEffort: 'high', webSearch: false })).toEqual([
      'grok',
      '-m',
      'grok-4',
      '--reasoning-effort',
      'high',
      '--disable-web-search',
    ]);
    expect(grokArgs({ webSearch: true })).toEqual(['grok']);
    expect(agyArgs({ model: 'gemini-x', effort: 'high' })).toEqual([
      'agy',
      '--model',
      'gemini-x',
      '--effort',
      'high',
      '--sandbox',
    ]);
    expect(agyArgs()).toEqual(['agy', '--sandbox']);
  });
});

describe('webAccessFromArgs', () => {
  it('reads the web switch off each vendor command line', () => {
    expect(webAccessFromArgs('grok', ['grok', '--disable-web-search'])).toBe('off');
    expect(webAccessFromArgs('grok.exe', ['grok', '-m', 'grok-4'])).toBe('on');
    expect(webAccessFromArgs('claude', claudeArgs())).toBe('off');
    expect(webAccessFromArgs('claude.cmd', claudeArgs({ tools: ['WebSearch', 'WebFetch'] }))).toBe(
      'on'
    );
    expect(webAccessFromArgs('claude', claudeArgs({ tools: ['Read'] }))).toBe('off');
    expect(webAccessFromArgs('claude', ['-p', '--tools', 'default'])).toBe('on');
    expect(
      webAccessFromArgs('claude', ['-p', '--tools', 'WebSearch,WebFetch', '--model', 'x'])
    ).toBe('on');
    expect(webAccessFromArgs('claude', ['-p'])).toBe('unknown');
    expect(webAccessFromArgs('codex', codexArgs())).toBe('off');
    expect(webAccessFromArgs('codex', codexArgs({ configOverrides: ['web_search="live"'] }))).toBe(
      'on'
    );
    expect(webAccessFromArgs('codex', codexArgs({ configOverrides: ['web_search=cached'] }))).toBe(
      'on'
    );
    expect(
      webAccessFromArgs('codex', codexArgs({ configOverrides: ['web_search="disabled"'] }))
    ).toBe('off');
    expect(webAccessFromArgs('agy', agyArgs())).toBe('unknown');
    expect(webAccessFromArgs('node', ['/shim.js', 'prompt-file', '--', 'grok'])).toBe('unknown');
  });
});
