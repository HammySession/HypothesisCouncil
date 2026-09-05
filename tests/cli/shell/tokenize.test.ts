import { splitShellArguments } from '../../../src/cli/shell/tokenize.js';

describe('shell tokenizer', () => {
  it('splits on whitespace and groups quoted spans', () => {
    expect(splitShellArguments('  "Explain the drift"  --dry-run --context src ')).toEqual([
      'Explain the drift',
      '--dry-run',
      '--context',
      'src',
    ]);
    expect(splitShellArguments("'single quoted' rest")).toEqual(['single quoted', 'rest']);
  });

  it('keeps apostrophes inside words and Windows paths intact', () => {
    expect(splitShellArguments("Why isn't the cache warm")).toEqual([
      'Why',
      "isn't",
      'the',
      'cache',
      'warm',
    ]);
    expect(splitShellArguments('--repo C:\\Users\\me\\repo')).toEqual([
      '--repo',
      'C:\\Users\\me\\repo',
    ]);
  });

  it('honours escaped quotes and spaces', () => {
    expect(splitShellArguments('"say \\"hi\\"" my\\ file')).toEqual(['say "hi"', 'my file']);
  });

  it('takes the rest of the line for an unterminated quote', () => {
    expect(splitShellArguments('"open ended goal --flag')).toEqual(['open ended goal --flag']);
    expect(splitShellArguments('')).toEqual([]);
  });
});
