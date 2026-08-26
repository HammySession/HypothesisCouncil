import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import type { ResearchSession } from './types.js';

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export class ResearchSessionStore {
  readonly root: string;

  constructor(root?: string) {
    this.root =
      root ||
      process.env.HYPOTHESIS_COUNCIL_HOME ||
      join(homedir(), '.mcp-rubber-duck', 'hypothesis-council');
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }

  createId(now = new Date()): string {
    const timestamp = now
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z')
      .replace('T', '-');
    return `RC-${timestamp}-${randomUUID().slice(0, 6)}`;
  }

  sessionDirectory(sessionId: string): string {
    const directory = join(this.root, safeName(sessionId));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  save(session: ResearchSession): void {
    session.updatedAt = new Date().toISOString();
    const path = join(this.sessionDirectory(session.id), 'session.json');
    this.atomicWrite(path, `${JSON.stringify(session, null, 2)}\n`);
    this.atomicWrite(join(this.root, 'current'), `${session.id}\n`);
  }

  load(sessionId?: string): ResearchSession {
    const resolved = sessionId || this.currentId();
    if (!resolved) throw new Error('No current research session');
    const path = join(this.sessionDirectory(resolved), 'session.json');
    if (!existsSync(path)) throw new Error(`Research session not found: ${resolved}`);
    return JSON.parse(readFileSync(path, 'utf8')) as ResearchSession;
  }

  currentId(): string | undefined {
    const path = join(this.root, 'current');
    if (!existsSync(path)) return undefined;
    return readFileSync(path, 'utf8').trim() || undefined;
  }

  use(sessionId: string): ResearchSession {
    const session = this.load(sessionId);
    this.atomicWrite(join(this.root, 'current'), `${session.id}\n`);
    return session;
  }

  list(): ResearchSession[] {
    return readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('RC-'))
      .flatMap((entry) => {
        const path = join(this.root, entry.name, 'session.json');
        if (!existsSync(path)) return [];
        try {
          return [JSON.parse(readFileSync(path, 'utf8')) as ResearchSession];
        } catch {
          return [];
        }
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  writeCallArtifact(
    sessionId: string,
    stage: string,
    callId: string,
    kind: 'raw' | 'parsed',
    contents: string
  ): string {
    const relativePath = join('calls', safeName(stage), `${safeName(callId)}.${kind}.json`);
    const absolutePath = join(this.sessionDirectory(sessionId), relativePath);
    this.atomicWrite(absolutePath, contents.endsWith('\n') ? contents : `${contents}\n`);
    return relativePath;
  }

  writeReport(sessionId: string, filename: string, contents: string): string {
    const absolutePath = join(this.sessionDirectory(sessionId), filename);
    this.atomicWrite(absolutePath, contents.endsWith('\n') ? contents : `${contents}\n`);
    return absolutePath;
  }

  writeContextPacket(sessionId: string, contents: string): string {
    return this.writeReport(sessionId, 'context-packet.txt', contents);
  }

  readContextPacket(sessionId: string): string {
    const path = join(this.sessionDirectory(sessionId), 'context-packet.txt');
    if (!existsSync(path)) throw new Error(`Context snapshot missing for session ${sessionId}`);
    return readFileSync(path, 'utf8');
  }

  private atomicWrite(path: string, contents: string): void {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, path);
  }
}
