/**
 * Split an interactive shell line into arguments. Double or single quotes at the start of a token
 * group words (`/run "Explain the drift" --dry-run`); a quote inside a word is literal so `it's`
 * survives. A backslash escapes only a following quote or space, so Windows paths such as
 * `C:\Users\me` pass through untouched. An unterminated quote takes the rest of the line.
 */
export function splitShellArguments(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else if (char === '\\' && line[index + 1] === quote) {
        current += quote;
        index++;
      } else {
        current += char;
      }
      continue;
    }
    if (/\s/.test(char)) {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
      continue;
    }
    if (char === '\\' && /["'\s]/.test(line[index + 1] ?? '')) {
      current += line[index + 1];
      index++;
      inToken = true;
      continue;
    }
    if ((char === '"' || char === "'") && !inToken) {
      quote = char;
      inToken = true;
      continue;
    }
    current += char;
    inToken = true;
  }
  if (inToken) tokens.push(current);
  return tokens;
}
