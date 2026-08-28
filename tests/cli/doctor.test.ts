import { doctorText, providerCommand, runDoctor } from '../../src/cli/doctor.js';
import type {
  ProviderDescriptor,
  ResearchCompletion,
  ResearchProviderGateway,
} from '../../src/research/types.js';

class FakeGateway implements ResearchProviderGateway {
  constructor(
    private readonly providers: ProviderDescriptor[] | Error,
    private readonly replies: Record<string, string | Error> = {}
  ) {}

  listProviders(): Promise<ProviderDescriptor[]> {
    return this.providers instanceof Error
      ? Promise.reject(this.providers)
      : Promise.resolve(this.providers);
  }

  healthCheck(): Promise<boolean> {
    return Promise.resolve(true);
  }

  complete(provider: string): Promise<ResearchCompletion> {
    const reply = this.replies[provider];
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve({ content: reply ?? '', model: 'm' });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

const environment: NodeJS.ProcessEnv = {
  CLI_CLAUDE_ENABLED: 'true',
  CLI_CUSTOM_GROK_COMMAND: '/node',
  CLI_CUSTOM_GROK_PROMPT_DELIVERY: 'stdin',
  CLI_CUSTOM_GROK_CLI_ARGS: '/shim.js,prompt-file,--,grok,-m,grok-4.6',
  CLI_GEMINI_ENABLED: 'true',
};

const providers: ProviderDescriptor[] = [
  { name: 'cli-claude', nickname: 'Claude', model: 'claude-fable-5[1m]', type: 'cli' },
  { name: 'cli-gemini', nickname: 'Gemini', model: 'gemini-3.1-pro', type: 'cli' },
  { name: 'cli-grok', nickname: 'Grok', model: 'grok-4.6', type: 'cli' },
  { name: 'openai', nickname: 'OpenAI', model: 'gpt-5.6', type: 'http' },
];

describe('hc doctor', () => {
  it('derives vendor commands, including those wrapped by the stdin shim', () => {
    expect(providerCommand(providers[0], environment)).toEqual({
      command: 'claude',
      viaStdinShim: false,
    });
    expect(providerCommand(providers[2], environment)).toEqual({
      command: 'grok',
      viaStdinShim: true,
    });
    expect(providerCommand(providers[3], environment)).toBeUndefined();
    expect(providerCommand({ ...providers[0], name: 'cli-aider' }, environment)).toBeUndefined();
  });

  it('reports transports, missing commands, and probe results', async () => {
    let clock = 0;
    const report = await runDoctor({
      gateway: new FakeGateway(providers, {
        'cli-claude': 'READY',
        'cli-gemini': new Error('boom'),
        openai: '',
      }),
      workingDirectory: '/sessions/doctor',
      sessionHome: '/sessions',
      environment,
      platform: 'win32',
      nodeVersion: 'v24.0.0',
      rubberDuckVersion: '1.20.5',
      probe: true,
      locateCommand: (command) => (command === 'grok' ? undefined : `/bin/${command}`),
      now: () => (clock += 1500),
    });

    const byName = Object.fromEntries(report.providers.map((entry) => [entry.name, entry]));
    expect(byName['cli-claude']).toMatchObject({
      command: 'claude',
      commandPath: '/bin/claude',
      transport: 'stdin',
      transportLimited: false,
      contextSource: 'model',
      probe: { ok: true, latencyMs: 1500, reply: 'READY' },
    });
    expect(byName['cli-gemini']).toMatchObject({
      transport: 'argument',
      transportLimited: true,
      maxContextBytes: 24 * 1024,
      probe: { ok: false, error: 'boom' },
    });
    expect(byName['cli-grok']).toMatchObject({
      command: 'grok',
      commandPath: undefined,
      viaStdinShim: true,
      transport: 'stdin',
    });
    expect(byName['cli-grok'].probe).toBeUndefined();
    expect(byName.openai).toMatchObject({ transport: 'http', probe: { ok: false } });
    expect(report.problems).toEqual([
      'cli-gemini: probe failed: boom',
      'cli-grok: command "grok" is not on PATH.',
      'openai: probe returned an empty reply.',
    ]);
    expect(
      report.hints.some((hint) => hint.includes('cli-gemini') && hint.includes('24.0 KiB'))
    ).toBe(true);

    const text = doctorText(report);
    expect(text).toContain('Platform: win32 · Node v24.0.0 · mcp-rubber-duck 1.20.5');
    expect(text).toContain('PROVIDER');
    expect(text).toContain('grok ✗ not found');
    expect(text).toContain('argument (24.0 KiB cap)');
    expect(text).toContain('stdin via shim');
    expect(text).toContain('ok 1.5s "READY"');
    expect(text).toContain('Problems:');
  });

  it('explains a Rubber Duck that cannot start', async () => {
    const report = await runDoctor({
      gateway: new FakeGateway(new Error('Unable to start the installed Rubber Duck MCP server.')),
      workingDirectory: '/sessions/doctor',
      sessionHome: '/sessions',
      environment: {},
      platform: 'linux',
    });

    expect(report.providers).toEqual([]);
    expect(report.problems[0]).toContain('Unable to start');
    expect(report.hints[0]).toContain('--preset quick');
    expect(doctorText(report)).toContain('✗ Unable to start');
  });

  it('suggests probing when no probe was requested', async () => {
    const report = await runDoctor({
      gateway: new FakeGateway(providers.slice(0, 1)),
      workingDirectory: '/sessions/doctor',
      sessionHome: '/sessions',
      environment,
      platform: 'linux',
      locateCommand: (command) => `/bin/${command}`,
    });

    expect(report.problems).toEqual([]);
    expect(report.hints).toContain(
      'Run `hc doctor --probe` to send a one-line prompt to every provider.'
    );
    expect(doctorText(report)).toContain('No problems found.');
  });
});
