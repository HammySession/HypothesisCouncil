import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseArguments } from '../../../src/cli/arguments.js';
import {
  addBasketPaths,
  addBasketSnippet,
  basketLines,
  basketPaths,
  basketPreviewLines,
  buildBasketPacket,
  clearBasket,
  createBasket,
  removeBasketPath,
} from '../../../src/cli/shell/basket.js';
import { createShellState } from '../../../src/cli/shell/context.js';
import { applyRunDefaults, runDefaultsFromState } from '../../../src/cli/shell/run-defaults.js';
import { createTestStore } from './fakes.js';

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'hc-basket-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'main.ts'), 'export const main = 1;\n');
  writeFileSync(join(root, 'notes.md'), '# Notes\n\nRemember the drift.\n');
  return root;
}

describe('context basket', () => {
  it('adds existing paths and globs, reports missing ones, and removes entries', () => {
    const root = repo();
    const basket = createBasket();
    expect(
      addBasketPaths(basket, ['notes.md', 'src/**/*.ts', 'missing.txt', 'notes.md/'], root)
    ).toEqual({
      added: ['notes.md', 'src/**/*.ts'],
      duplicates: ['notes.md'],
      missing: ['missing.txt'],
    });
    expect(removeBasketPath(basket, 'src/**/*.ts')).toBe(true);
    expect(removeBasketPath(basket, 'nope')).toBe(false);
    expect(basket.paths).toEqual(['notes.md']);
    clearBasket(basket);
    expect(basketPaths(basket)).toEqual([]);
  });

  it('materialises pasted snippets under the session home and includes them in the packet', () => {
    const root = repo();
    const store = createTestStore();
    const basket = createBasket();
    addBasketPaths(basket, ['notes.md'], root);
    const snippet = addBasketSnippet(basket, store.root, 'Stack trace', 'Error: boom\n  at main');
    expect(snippet.path).toBe(join(store.root, 'basket', '01-Stack-trace.md'));
    expect(readFileSync(snippet.path, 'utf8')).toBe('# Stack trace\n\nError: boom\n  at main\n');
    expect(() => addBasketSnippet(basket, store.root, 'empty', '   ')).toThrow(
      'The snippet is empty'
    );

    const built = buildBasketPacket(basket, root, 64 * 1024);
    expect(built.packet).toContain('Remember the drift.');
    expect(built.packet).toContain('Error: boom');
    const preview = basketPreviewLines(built, basket);
    expect(preview).toHaveLength(4);
    expect(preview[0]).toMatch(/^Context basket: 2 files, .* of 64\.0 KiB$/);
    expect(preview.slice(1, 3).sort()).toEqual(
      [`  + ${snippet.path.replace(/\\/g, '/')}`, '  + notes.md'].sort()
    );
    expect(preview[3]).toBe('  Pasted snippets are sent verbatim; they are not secret-filtered.');
    expect(basketLines(basket, root)).toEqual([
      'Context basket (2 items):',
      '  notes.md',
      '  Stack trace (pasted, 37 B)',
    ]);
    expect(removeBasketPath(basket, 'Stack trace')).toBe(true);
    expect(basket.snippets).toEqual([]);
    expect(existsSync(snippet.path)).toBe(true);
  });

  it('feeds /run defaults from the shell state without overriding explicit flags', () => {
    const root = repo();
    const state = createShellState(createTestStore(), root);
    addBasketPaths(state.basket, ['notes.md'], root);
    state.basket.markdownOnly = true;
    expect(runDefaultsFromState(state)).toEqual({
      repositoryPath: root,
      contextPaths: ['notes.md'],
      markdownOnly: true,
    });

    const parsed = applyRunDefaults(parseArguments(['goal']), runDefaultsFromState(state));
    expect(parsed.flags.get('--repo')).toEqual([root]);
    expect(parsed.flags.get('--context')).toEqual(['notes.md']);
    expect(parsed.flags.get('--markdown-only')).toEqual(['true']);

    const explicit = applyRunDefaults(
      parseArguments(['goal', '--repo', 'elsewhere', '--context', 'README.md']),
      runDefaultsFromState(state)
    );
    expect(explicit.flags.get('--repo')).toEqual(['elsewhere']);
    expect(explicit.flags.get('--context')).toEqual(['README.md']);
  });
});
