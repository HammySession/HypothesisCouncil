import { resolve } from 'path';
import { createRunInput } from '../../src/cli/run-options.js';

describe('sources, scouts, and web run options', () => {
  it('resolves the sources file against the working directory and passes scouts through', () => {
    const input = createRunInput(
      {
        goalParts: ['Explain', 'the', 'drift'],
        contextPaths: [],
        sourcesFile: 'docs/sources.md',
        scouts: ['cli-claude_scout'],
        web: 'off',
      },
      '/work/repo'
    );
    expect(input).toMatchObject({
      goal: 'Explain the drift',
      sourcesFile: resolve('/work/repo', 'docs/sources.md'),
      scouts: ['cli-claude_scout'],
      web: 'off',
    });
    const bare = createRunInput({ goalParts: [], contextPaths: [] }, '/work/repo');
    expect(bare.sourcesFile).toBeUndefined();
    expect(bare.scouts).toBeUndefined();
    expect(bare.web).toBeUndefined();
  });
});
