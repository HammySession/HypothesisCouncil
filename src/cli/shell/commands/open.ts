import { catalogFor, openReport } from '../../reports-command.js';
import type { ShellCommand } from '../registry.js';

export const openCommand: ShellCommand = {
  name: 'open',
  usage: '/open N|SESSION|index',
  summary: 'Open a report from the last /reports listing (or the gallery) in the browser',
  run: (ctx, args) => {
    const reference = args.trim() || ctx.state.selectedSession;
    if (!reference) throw new Error('Usage: /open N|SESSION|index (run /reports first)');
    const catalog = catalogFor(ctx.store);
    const listing =
      ctx.state.lastReportListing.length > 0
        ? ctx.state.lastReportListing
            .map((id, position) => {
              const entry = catalog.find((item) => item.id === id);
              return entry ? { ...entry, index: position + 1 } : undefined;
            })
            .filter((entry) => entry !== undefined)
        : catalog;
    openReport(reference, ctx.store, ctx, listing);
    return Promise.resolve();
  },
};
