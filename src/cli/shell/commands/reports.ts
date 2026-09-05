import { flag, hasFlag, parseArguments } from '../../arguments.js';
import { listReports } from '../../reports-command.js';
import type { ShellCommand } from '../registry.js';
import { splitShellArguments } from '../tokenize.js';

export const reportsCommand: ShellCommand = {
  name: 'reports',
  usage: '/reports [TEXT] [--tag TAG] [--json] [--html [--open]]',
  summary: 'List saved reports with tags; --html writes the gallery, --open opens it',
  run: (ctx, args) => {
    const parsed = parseArguments(splitShellArguments(args));
    const listing = listReports(ctx.store, ctx, {
      filter: flag(parsed, '--filter') ?? (parsed.positionals.join(' ') || undefined),
      tag: flag(parsed, '--tag'),
      json: hasFlag(parsed, '--json'),
      html: hasFlag(parsed, '--html'),
      open: hasFlag(parsed, '--open'),
    });
    ctx.state.lastReportListing = listing.entries.map((entry) => entry.id);
    ctx.io.out(listing.text);
    if (listing.galleryPath) ctx.io.out(`Gallery: ${listing.galleryPath}`);
    if (listing.entries.length > 0 && !hasFlag(parsed, '--json')) {
      ctx.io.out('Open one with /open N (or /open index for the gallery); tag with /tag.');
    }
    return Promise.resolve();
  },
};
