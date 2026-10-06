import { resolve } from 'path';
import { createRunInput, DEFAULT_REPOSITORY_GOAL } from '../../src/cli/run-options.js';

describe('createRunInput', () => {
  it('turns a bare hc run into a current-repository analysis', () => {
    const input = createRunInput({ goalParts: [], contextPaths: [] }, '/work/example-project');

    expect(input).toMatchObject({
      goal: DEFAULT_REPOSITORY_GOAL,
      contextRoot: resolve('/work/example-project'),
      contextPaths: ['.'],
      markdownOnly: false,
    });
  });

  it('resolves another repository while preserving explicit context paths and Markdown mode', () => {
    const input = createRunInput(
      {
        goalParts: ['Find', 'data leakage'],
        contextPaths: ['README.md', 'docs'],
        repositoryPath: '../example-project',
        markdownOnly: true,
      },
      '/work/hypothesis-council'
    );

    expect(input).toMatchObject({
      goal: 'Find data leakage',
      contextRoot: resolve('/work/example-project'),
      contextPaths: ['README.md', 'docs'],
      markdownOnly: true,
    });
  });
});
