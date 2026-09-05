/**
 * Minimal argument parsing shared by the `hc` command line and the interactive shell. Flags are
 * `--name value` or `--name=value`; boolean flags never consume the next token; repeated flags
 * accumulate so `--context a --context b` works.
 */

export interface ParsedArguments {
  positionals: string[];
  flags: Map<string, string[]>;
}

export const BOOLEAN_FLAGS = new Set([
  '--all',
  '--allow-dirty',
  '--allow-single',
  '--dry-run',
  '--help',
  '--html',
  '--json',
  '--markdown-only',
  '--no-draft',
  '--no-interview',
  '--open',
  '--pick',
  '--print',
  '--probe',
  '--refresh',
  '--run',
  '--visible',
  '--yes',
]);

export function parseArguments(args: string[]): ParsedArguments {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const [name, inline] = value.split('=', 2);
    const next = args[index + 1];
    const flagValue =
      inline ??
      (!BOOLEAN_FLAGS.has(name) && next && !next.startsWith('--') ? args[++index] : 'true');
    flags.set(name, [...(flags.get(name) || []), flagValue]);
  }
  return { positionals, flags };
}

/** The last value given for a flag, or undefined when it was not passed. */
export function flag(parsed: ParsedArguments, name: string): string | undefined {
  return parsed.flags.get(name)?.at(-1);
}

/** True when a boolean flag was passed (or any flag was given the literal value `true`). */
export function hasFlag(parsed: ParsedArguments, name: string): boolean {
  return flag(parsed, name) === 'true';
}

export function flagValues(parsed: ParsedArguments, name: string): string[] {
  return parsed.flags.get(name) || [];
}

export function numberFlag(parsed: ParsedArguments, name: string): number | undefined {
  const value = flag(parsed, name);
  if (value === undefined) return undefined;
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${name} must be a number`);
  return result;
}

export function pathFlag(parsed: ParsedArguments, name: string): string | undefined {
  const value = flag(parsed, name);
  if (value === 'true') throw new Error(`${name} requires a path`);
  return value;
}

/** `--model KEY=ID`, repeatable; keys are lower-cased. Entries without `=` are an error. */
export function parseModelFlags(parsed: ParsedArguments): Record<string, string> {
  const models: Record<string, string> = {};
  for (const entry of flagValues(parsed, '--model')) {
    const separator = entry.indexOf('=');
    const key = separator > 0 ? entry.slice(0, separator).trim().toLowerCase() : '';
    const id = separator > 0 ? entry.slice(separator + 1).trim() : '';
    if (!key || !id) {
      throw new Error(
        `--model expects KEY=ID (for example --model codex=gpt-5.6-sol), got "${entry}"`
      );
    }
    models[key] = id;
  }
  return models;
}

/** A flag that must carry a value, such as `--novelty 8`; bare use is an error. */
export function valueFlag(
  parsed: ParsedArguments,
  name: string,
  expected = 'a value'
): string | undefined {
  const value = flag(parsed, name);
  if (value === 'true') throw new Error(`${name} requires ${expected}`);
  return value;
}

/** Comma-separated list flag such as `--providers a,b`. */
export function listFlag(parsed: ParsedArguments, name: string): string[] | undefined {
  const value = flag(parsed, name);
  if (value === undefined) return undefined;
  if (value === 'true') throw new Error(`${name} requires a comma-separated list`);
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
