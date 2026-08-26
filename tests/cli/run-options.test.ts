import { createRunInput, DEFAULT_REPOSITORY_GOAL } from '../../src/cli/run-options.js';

describe('createRunInput', () => {
  it('turns a bare hc run into a current-repository analysis', () => {
    const input = createRunInput({ goalParts: [], contextPaths: [] }, '/work/stock_embeddings');

    expect(input).toMatchObject({
      goal: DEFAULT_REPOSITORY_GOAL,
      contextRoot: '/work/stock_embeddings',
      contextPaths: ['.'],
      markdownOnly: false,
    });
  });

  it('resolves another repository while preserving explicit context paths and Markdown mode', () => {
    const input = createRunInput(
      {
        goalParts: ['Find', 'data leakage'],
        contextPaths: ['README.md', 'docs'],
        repositoryPath: '../stock_embeddings',
        markdownOnly: true,
      },
      '/work/hypothesis-council'
    );

    expect(input).toMatchObject({
      goal: 'Find data leakage',
      contextRoot: '/work/stock_embeddings',
      contextPaths: ['README.md', 'docs'],
      markdownOnly: true,
    });
  });
});
