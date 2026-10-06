import { hasFlag, parseArguments, parseModelFlags } from '../../src/cli/arguments.js';

describe('model flags', () => {
  it('collects repeatable --model KEY=ID pairs with lower-cased keys', () => {
    const parsed = parseArguments([
      'run',
      '--model',
      'codex=gpt-5.5',
      '--model',
      'AGY=gemini-3.1-pro-high',
      'goal',
    ]);
    expect(parseModelFlags(parsed)).toEqual({ codex: 'gpt-5.5', agy: 'gemini-3.1-pro-high' });
    expect(parsed.positionals).toEqual(['run', 'goal']);
  });

  it('rejects entries without KEY=ID', () => {
    expect(() => parseModelFlags(parseArguments(['--model', 'gpt-5.5']))).toThrow(
      '--model expects KEY=ID (for example --model codex=gpt-6.1-sol), got "gpt-5.5"'
    );
    expect(() => parseModelFlags(parseArguments(['--model', 'codex=']))).toThrow(
      '--model expects KEY=ID'
    );
    expect(parseModelFlags(parseArguments(['run']))).toEqual({});
  });

  it('treats --refresh as a boolean flag', () => {
    const parsed = parseArguments(['models', '--refresh', '--preset', 'frontier']);
    expect(hasFlag(parsed, '--refresh')).toBe(true);
    expect(parsed.positionals).toEqual(['models']);
  });
});
