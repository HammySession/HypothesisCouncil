import { DEFAULT_DIAL_POLICY } from '../../src/research/dials.js';
import {
  PROMPT_VERSIONS,
  WEB_SCOUT_NOTICE,
  buildSourceCritiquePrompt,
  buildSourceCritiqueRepairPrompt,
  buildSourceScoutPrompt,
  buildSourceScoutRepairPrompt,
} from '../../src/research/prompts.js';
import type { SourceRecord } from '../../src/research/sources.js';

describe('source prompts', () => {
  it('asks scouts for verifiable sources and lists what is already collected', () => {
    const prompt = buildSourceScoutPrompt('Why do failures cluster at open?', DEFAULT_DIAL_POLICY, {
      count: 4,
      round: 2,
      rounds: 2,
      avoid: ['https://example.org/a', 'doi:10.1000/b'],
      contextPaths: Array.from({ length: 45 }, (_, index) => `src/file-${index}.ts`),
    });
    expect(prompt.startsWith(`${PROMPT_VERSIONS.sourceScout}\n${WEB_SCOUT_NOTICE}`)).toBe(true);
    expect(prompt).toContain('Find exactly 4 primary sources');
    expect(prompt).toContain('scouting round 2 of 2; go further from the obvious hits');
    expect(prompt).toContain(
      'ALREADY COLLECTED (do not repeat these)\n- https://example.org/a\n- doi:10.1000/b'
    );
    expect(prompt).toContain('src/file-39.ts\n... 5 more');
    expect(prompt).not.toContain('src/file-40.ts');
    expect(prompt).toContain('Never invent a URL, DOI, author, or venue');
    expect(prompt).toContain('Balance canonical references with recent or contrarian results.');

    const novel = buildSourceScoutPrompt(
      'Goal',
      { ...DEFAULT_DIAL_POLICY, novelty: 9 },
      { count: 2 }
    );
    expect(novel).toContain('adjacent disciplines');
    expect(novel).not.toContain('scouting round');
    expect(novel).not.toContain('ALREADY COLLECTED');
    const conservative = buildSourceScoutPrompt(
      'Goal',
      { ...DEFAULT_DIAL_POLICY, novelty: 1 },
      { count: 2 }
    );
    expect(conservative).toContain('Prefer the established, widely cited primary references.');

    const repair = buildSourceScoutRepairPrompt('raw scout text', 4);
    expect(repair.startsWith(PROMPT_VERSIONS.sourceScoutRepair)).toBe(true);
    expect(repair).toContain('keep at most 4');
    expect(repair).toContain('PREVIOUS_RESPONSE_BEGIN\nraw scout text\nPREVIOUS_RESPONSE_END');
  });

  it('grades sources without revealing who proposed them', () => {
    const sources: SourceRecord[] = [
      {
        id: 'S-001',
        title: 'Alpha',
        url: 'https://example.org/alpha',
        origin: 'scout',
        kind: 'paper',
        scoutProvider: 'cli-claude_scout',
        summary: 'Claims X.',
        verification: { status: 'reachable', checkedAt: 'now' },
      },
      { id: 'S-002', title: 'Beta', doi: '10.1000/beta', origin: 'user', kind: 'other' },
    ];
    const prompt = buildSourceCritiquePrompt('Goal text', sources, DEFAULT_DIAL_POLICY);
    expect(prompt.startsWith(PROMPT_VERSIONS.sourceCritique)).toBe(true);
    expect(prompt).toContain('RESEARCH GOAL\nGoal text');
    expect(prompt).toContain('"id": "S-001"');
    expect(prompt).toContain('"verification": "reachable"');
    expect(prompt).toContain('"verification": "unchecked"');
    expect(prompt).toContain('"origin": "scout"');
    expect(prompt).not.toContain('cli-claude_scout');
    expect(prompt).not.toContain('scoutProvider');
    expect(prompt).toContain('"assessments"');

    const repair = buildSourceCritiqueRepairPrompt('raw critique');
    expect(repair.startsWith(PROMPT_VERSIONS.sourceCritiqueRepair)).toBe(true);
    expect(repair).toContain('PREVIOUS_RESPONSE_BEGIN\nraw critique\nPREVIOUS_RESPONSE_END');
  });
});
