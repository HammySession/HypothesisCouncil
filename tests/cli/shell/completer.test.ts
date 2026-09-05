import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SHELL_COMMANDS } from '../../../src/cli/shell/commands/index.js';
import { completePath, createShellCompleter } from '../../../src/cli/shell/completer.js';
import { createTestContext, createTestStore, seedSession } from './fakes.js';

describe('shell completion', () => {
  function setup() {
    const store = createTestStore();
    seedSession(store);
    const ctx = createTestContext({ store });
    mkdirSync(join(ctx.cwd, 'src'));
    writeFileSync(join(ctx.cwd, 'src', 'main.ts'), '');
    writeFileSync(join(ctx.cwd, 'README.md'), '');
    ctx.state.knownProviders.push('cli-codex');
    return { ctx, complete: createShellCompleter(ctx, () => SHELL_COMMANDS) };
  }

  it('completes command names', () => {
    const { complete } = setup();
    expect(complete('/re')).toEqual([['/repo', '/report', '/reports', '/resume'], '/re']);
    expect(complete('/zzz')).toEqual([[], '/zzz']);
  });

  it('completes session ids, providers, and repository paths', () => {
    const { ctx, complete } = setup();
    expect(complete('/use RC-')).toEqual([['RC-20260827-000000Z-abc123'], 'RC-']);
    expect(complete('/open ')).toEqual([['RC-20260827-000000Z-abc123', 'index'], '']);
    expect(complete('/duck duck-a,du')).toEqual([['duck-a', 'duck-b'], 'du']);
    expect(complete('/duck a')).toEqual([['all', 'auto'], 'a']);
    expect(complete('what about @sr')).toEqual([['@src/'], '@sr']);
    expect(complete('@d')).toEqual([['@duck-a', '@duck-b'], '@d']);
    expect(complete('/context add src/ma')).toEqual([['src/main.ts'], 'src/ma']);
    expect(complete('/repo s')).toEqual([['src/'], 's']);
    expect(complete('plain text')).toEqual([[], 'text']);
    expect(completePath('nowhere/', ctx.cwd)).toEqual([]);
  });
});
