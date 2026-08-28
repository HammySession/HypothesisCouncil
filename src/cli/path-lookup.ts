import { statSync } from 'fs';
import { delimiter, isAbsolute, join } from 'path';

/**
 * Locate an executable the way a shell would, including Windows `PATHEXT` extensions, without
 * spawning anything. Returns the resolved path or undefined when the command is not available.
 */
export function findCommand(
  command: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  const extensions =
    platform === 'win32'
      ? ['', ...(environment.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
      : [''];
  const explicit = isAbsolute(command) || command.includes('/') || command.includes('\\');
  const searchPath = environment.PATH || environment.Path || '';
  const candidates = explicit
    ? [command]
    : searchPath
        .split(delimiter)
        .filter(Boolean)
        .map((directory) => join(directory, command));
  for (const candidate of candidates) {
    for (const extension of extensions) {
      const path = `${candidate}${extension}`;
      try {
        if (statSync(path).isFile()) return path;
      } catch {
        // Not present with this extension in this directory.
      }
    }
  }
  return undefined;
}
