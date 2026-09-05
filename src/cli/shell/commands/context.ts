import {
  addBasketPaths,
  addBasketSnippet,
  basketLines,
  basketPreviewLines,
  basketSize,
  buildBasketPacket,
  clearBasket,
  removeBasketPath,
} from '../basket.js';
import type { ShellCommand } from '../registry.js';
import { splitShellArguments } from '../tokenize.js';

const USAGE =
  'Usage: /context [show [--full]] | add PATH|GLOB... | add-text LABEL | rm PATH|LABEL | clear | markdown on|off';

/** Bytes used when previewing the basket without a provider budget. */
const PREVIEW_MAX_BYTES = 512 * 1024;

export const contextCommand: ShellCommand = {
  name: 'context',
  aliases: ['ctx'],
  usage: '/context add PATH|GLOB... | add-text LABEL | rm X | clear | markdown on|off | show',
  summary: 'Manage the context basket shared by chat questions and /run',
  run: async (ctx, args) => {
    const { state, io } = ctx;
    const [verb, ...rest] = splitShellArguments(args);
    switch (verb) {
      case undefined:
      case 'list': {
        for (const line of basketLines(state.basket, state.repoRoot)) io.out(line);
        return;
      }
      case 'show': {
        if (basketSize(state.basket) === 0) {
          io.out(basketLines(state.basket, state.repoRoot)[0]);
          return;
        }
        const built = buildBasketPacket(state.basket, state.repoRoot, PREVIEW_MAX_BYTES);
        for (const line of basketPreviewLines(built, state.basket)) io.out(line);
        if (rest.includes('--full')) io.out(built.packet);
        return;
      }
      case 'add': {
        if (rest.length === 0) throw new Error(USAGE);
        const result = addBasketPaths(state.basket, rest, state.repoRoot);
        if (result.added.length > 0) io.out(`Added: ${result.added.join(', ')}`);
        if (result.duplicates.length > 0)
          io.out(`Already present: ${result.duplicates.join(', ')}`);
        if (result.missing.length > 0) {
          throw new Error(`Not found under ${state.repoRoot}: ${result.missing.join(', ')}`);
        }
        return;
      }
      case 'add-text':
      case 'paste': {
        const label = rest.join(' ').trim() || `snippet-${state.basket.snippets.length + 1}`;
        const text = await io.readBlock(`Paste the text for "${label}"`);
        const snippet = addBasketSnippet(state.basket, ctx.store.root, label, text);
        io.out(`Added pasted text "${snippet.label}" (${snippet.bytes} bytes)`);
        return;
      }
      case 'rm':
      case 'remove': {
        if (rest.length === 0) throw new Error(USAGE);
        const missing = rest.filter((value) => !removeBasketPath(state.basket, value));
        if (missing.length > 0) throw new Error(`Not in the basket: ${missing.join(', ')}`);
        io.out(`Removed: ${rest.join(', ')}`);
        return;
      }
      case 'clear': {
        clearBasket(state.basket);
        state.confirmedPackets.clear();
        io.out('Context basket cleared');
        return;
      }
      case 'markdown':
      case 'markdown-only': {
        const mode = rest[0];
        if (mode !== 'on' && mode !== 'off') throw new Error(USAGE);
        state.basket.markdownOnly = mode === 'on';
        io.out(`Markdown only: ${mode}`);
        return;
      }
      default:
        throw new Error(`${USAGE}\nUnknown verb: ${verb}`);
    }
  },
};
