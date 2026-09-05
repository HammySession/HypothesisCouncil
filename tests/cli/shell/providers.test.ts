import {
  parseSelection,
  resolveMention,
  resolveProviderSelection,
  splitMentions,
} from '../../../src/cli/shell/providers.js';

const PROVIDERS = [
  { name: 'cli-codex', nickname: 'Codex', type: 'cli' },
  { name: 'cli-claude', nickname: 'Claude', type: 'cli' },
  { name: 'openai', nickname: 'OpenAI', type: 'http' },
];

describe('provider mentions', () => {
  it('resolves names, nicknames, cli- stripped names, and unique prefixes', () => {
    expect(resolveMention('cli-codex', PROVIDERS)).toBe('cli-codex');
    expect(resolveMention('Codex', PROVIDERS)).toBe('cli-codex');
    expect(resolveMention('claude', PROVIDERS)).toBe('cli-claude');
    expect(resolveMention('op', PROVIDERS)).toBe('openai');
    expect(resolveMention('cli', PROVIDERS)).toBeUndefined();
    expect(resolveMention('', PROVIDERS)).toBeUndefined();
  });

  it('splits provider and path mentions out of a chat line', () => {
    expect(splitMentions('@codex @src/main.ts what does this do?', PROVIDERS)).toEqual({
      providers: ['cli-codex'],
      paths: ['src/main.ts'],
      text: 'what does this do?',
    });
    expect(splitMentions('@claude, @codex: compare', PROVIDERS)).toEqual({
      providers: ['cli-claude', 'cli-codex'],
      paths: [],
      text: 'compare',
    });
    expect(splitMentions('plain question', PROVIDERS)).toEqual({
      providers: [],
      paths: [],
      text: 'plain question',
    });
  });

  it('parses /duck arguments', () => {
    expect(parseSelection('', PROVIDERS)).toEqual({ kind: 'auto' });
    expect(parseSelection('auto', PROVIDERS)).toEqual({ kind: 'auto' });
    expect(parseSelection('all', PROVIDERS)).toEqual({ kind: 'all' });
    expect(parseSelection('codex,claude claude', PROVIDERS)).toEqual({
      kind: 'named',
      names: ['cli-codex', 'cli-claude'],
    });
    expect(parseSelection('unknown', PROVIDERS)).toEqual({ kind: 'named', names: ['unknown'] });
  });

  it('turns a selection into validated provider names', () => {
    expect(resolveProviderSelection({ kind: 'auto' }, PROVIDERS)).toEqual(['cli-codex']);
    expect(resolveProviderSelection({ kind: 'auto' }, PROVIDERS, 'openai')).toEqual(['openai']);
    expect(resolveProviderSelection({ kind: 'all' }, PROVIDERS)).toEqual([
      'cli-codex',
      'cli-claude',
      'openai',
    ]);
    expect(
      resolveProviderSelection({ kind: 'named', names: ['codex', 'Codex'] }, PROVIDERS)
    ).toEqual(['cli-codex']);
    expect(() => resolveProviderSelection({ kind: 'named', names: ['nope'] }, PROVIDERS)).toThrow(
      'Unknown provider: nope (available: cli-codex, cli-claude, openai)'
    );
    expect(() => resolveProviderSelection({ kind: 'auto' }, [])).toThrow(
      'No Rubber Duck provider is configured'
    );
  });
});
