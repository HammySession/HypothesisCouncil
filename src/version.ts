import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/** The package version, read from package.json so it is written in one place. */
export const VERSION = (require('../package.json') as { version: string }).version;
