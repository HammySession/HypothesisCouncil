import {
  flag,
  flagValues,
  hasFlag,
  listFlag,
  numberFlag,
  parseArguments,
  pathFlag,
} from '../../src/cli/arguments.js';

describe('CLI argument parsing', () => {
  it('separates positionals from valued, inline, repeated, and boolean flags', () => {
    const parsed = parseArguments([
      'Explain',
      'drift',
      '--context',
      'src',
      '--context=docs',
      '--json',
      'after-json',
      '--seed',
      '7',
    ]);

    expect(parsed.positionals).toEqual(['Explain', 'drift', 'after-json']);
    expect(flagValues(parsed, '--context')).toEqual(['src', 'docs']);
    expect(flag(parsed, '--context')).toBe('docs');
    expect(hasFlag(parsed, '--json')).toBe(true);
    expect(hasFlag(parsed, '--yes')).toBe(false);
    expect(numberFlag(parsed, '--seed')).toBe(7);
    expect(numberFlag(parsed, '--top-k')).toBeUndefined();
  });

  it('treats a valued flag at the end of the line as boolean', () => {
    const parsed = parseArguments(['--preset']);
    expect(flag(parsed, '--preset')).toBe('true');
  });

  it('validates numbers, paths, and lists', () => {
    expect(() => numberFlag(parseArguments(['--seed', 'x']), '--seed')).toThrow(
      '--seed must be a number'
    );
    expect(() => pathFlag(parseArguments(['--out']), '--out')).toThrow('--out requires a path');
    expect(pathFlag(parseArguments(['--out', 'reports/']), '--out')).toBe('reports/');
    expect(listFlag(parseArguments(['--providers', 'a, b,,c']), '--providers')).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(listFlag(parseArguments([]), '--providers')).toBeUndefined();
    expect(() => listFlag(parseArguments(['--providers']), '--providers')).toThrow(
      'comma-separated list'
    );
  });
});
