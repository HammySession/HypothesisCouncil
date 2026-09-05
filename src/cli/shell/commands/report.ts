import { renderProposalMarkdown } from '../../../research/proposal/report.js';
import { ensureHtmlReport, reportText } from '../../report-files.js';
import { loadSelectedProposal, proposalSelected } from '../proposal-scope.js';
import type { ShellCommand } from '../registry.js';

export const reportCommand: ShellCommand = {
  name: 'report',
  usage: '/report [html]',
  summary: 'Show the Markdown report; /report html opens it in the browser',
  run: (ctx, args) => {
    if (proposalSelected(ctx)) {
      if (args) throw new Error('Proposals have no HTML report yet; /proposal shows the Markdown');
      ctx.io.out(renderProposalMarkdown(loadSelectedProposal(ctx)));
      return Promise.resolve();
    }
    const session = ctx.store.load(ctx.state.selectedSession);
    if (args === 'html') {
      const target = ensureHtmlReport(ctx.store, session);
      ctx.io.out(`HTML report: ${target}`);
      ctx.openInBrowser(target);
      return Promise.resolve();
    }
    if (args) throw new Error('Usage: /report [html]');
    ctx.io.out(reportText(session, false));
    return Promise.resolve();
  },
};
