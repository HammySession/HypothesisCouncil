import type { z } from 'zod';

function jsonCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fence: RegExpExecArray | null;
  while ((fence = fencePattern.exec(raw)) !== null) {
    candidates.push(fence[1].trim());
  }

  for (let start = 0; start < raw.length; start++) {
    const opener = raw[start];
    if (opener !== '{' && opener !== '[') continue;
    const closer = opener === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < raw.length; index++) {
      const character = raw[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === opener) {
        depth++;
      } else if (character === closer) {
        depth--;
        if (depth === 0) {
          candidates.push(raw.slice(start, index + 1));
          start = index;
          break;
        }
      }
    }
  }

  return [...new Set(candidates.filter(Boolean))];
}

export function parseStructuredOutput<T>(raw: string, schema: z.ZodType<T>): T {
  const errors: string[] = [];
  for (const candidate of jsonCandidates(raw)) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
      errors.push(result.error.issues.map((issue) => issue.message).join(', '));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`No valid structured JSON found: ${errors.at(-1) || 'empty output'}`);
}
