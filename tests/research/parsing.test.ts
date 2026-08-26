import { z } from 'zod';
import { parseStructuredOutput } from '../../src/research/parsing.js';

const schema = z.object({ value: z.string() });

describe('parseStructuredOutput', () => {
  it.each([
    ['direct JSON', '{"value":"direct"}', 'direct'],
    ['fenced JSON', 'Here:\n```json\n{"value":"fenced"}\n```', 'fenced'],
    ['prose-wrapped JSON', 'prefix {"value":"wrapped"} suffix', 'wrapped'],
  ])('parses %s', (_name, raw, expected) => {
    expect(parseStructuredOutput(raw, schema)).toEqual({ value: expected });
  });

  it('rejects malformed or schema-invalid output', () => {
    expect(() => parseStructuredOutput('{"other":true}', schema)).toThrow(
      'No valid structured JSON found'
    );
  });
});
