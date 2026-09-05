import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import type { ResearchSession, SessionMeta } from './types.js';

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export function defaultSessionHome(): string {
  return (
    process.env.HYPOTHESIS_COUNCIL_HOME || join(homedir(), '.mcp-rubber-duck', 'hypothesis-council')
  );
}

export interface StoredSession {
  id: string;
  updatedAt: string;
  meta?: SessionMeta;
}

export interface SessionStoreOptions {
  /** Session id prefix, also the directory-name prefix `list` scans for (for example `RC-`). */
  idPrefix: string;
  /** Name of the file under `root` that records the current session id. */
  currentFile: string;
}

/**
 * Durable, inspectable session storage: one directory per session holding `session.json`, call
 * artifacts, and reports. Writes are atomic so an interrupted run never leaves a torn file.
 */
export abstract class SessionStoreBase<T extends StoredSession> {
  readonly root: string;
  protected readonly options: SessionStoreOptions;

  constructor(root: string | undefined, options: SessionStoreOptions) {
    this.root = root || defaultSessionHome();
    this.options = options;
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
  }

  createId(now = new Date()): string {
    const timestamp = now
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z')
      .replace('T', '-');
    return `${this.options.idPrefix}${timestamp}-${randomUUID().slice(0, 6)}`;
  }

  sessionDirectory(sessionId: string): string {
    const directory = join(this.root, safeName(sessionId));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  /** Absolute path of a file inside the session directory (the directory is created). */
  artifactPath(sessionId: string, filename: string): string {
    return join(this.sessionDirectory(sessionId), filename);
  }

  artifactExists(sessionId: string, filename: string): boolean {
    return existsSync(join(this.root, safeName(sessionId), filename));
  }

  save(session: T): void {
    session.updatedAt = new Date().toISOString();
    this.atomicWrite(this.artifactPath(session.id, 'session.json'), this.serialize(session));
    this.atomicWrite(join(this.root, this.options.currentFile), `${session.id}\n`);
  }

  load(sessionId?: string): T {
    const resolved = sessionId || this.currentId();
    if (!resolved) throw new Error(this.missingCurrentMessage());
    const path = join(this.sessionDirectory(resolved), 'session.json');
    if (!existsSync(path)) throw new Error(this.notFoundMessage(resolved));
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  }

  currentId(): string | undefined {
    const path = join(this.root, this.options.currentFile);
    if (!existsSync(path)) return undefined;
    return readFileSync(path, 'utf8').trim() || undefined;
  }

  use(sessionId: string): T {
    const session = this.load(sessionId);
    this.atomicWrite(join(this.root, this.options.currentFile), `${session.id}\n`);
    return session;
  }

  list(): T[] {
    return readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(this.options.idPrefix))
      .flatMap((entry) => {
        const path = join(this.root, entry.name, 'session.json');
        if (!existsSync(path)) return [];
        try {
          return [JSON.parse(readFileSync(path, 'utf8')) as T];
        } catch {
          return [];
        }
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  /**
   * Merge user-facing metadata (title, tags, summary) into a persisted session without touching
   * `updatedAt` or the current-session pointer: annotating a report is not research activity.
   */
  updateMeta(sessionId: string, patch: Partial<SessionMeta>): T {
    const session = this.load(sessionId);
    const previous = session.meta ?? {};
    const tags =
      patch.tags === undefined ? previous.tags : [...new Set(patch.tags.map((tag) => tag.trim()))];
    session.meta = { ...previous, ...patch, ...(tags === undefined ? {} : { tags }) };
    for (const key of Object.keys(session.meta) as Array<keyof SessionMeta>) {
      if (session.meta[key] === undefined) delete session.meta[key];
    }
    this.atomicWrite(this.artifactPath(session.id, 'session.json'), this.serialize(session));
    return session;
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
    const absolutePath = this.artifactPath(sessionId, filename);
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

  protected missingCurrentMessage(): string {
    return 'No current session';
  }

  protected notFoundMessage(sessionId: string): string {
    return `Session not found: ${sessionId}`;
  }

  private serialize(session: T): string {
    return `${JSON.stringify(session, null, 2)}\n`;
  }

  protected atomicWrite(path: string, contents: string): void {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, path);
  }
}

export class ResearchSessionStore extends SessionStoreBase<ResearchSession> {
  constructor(root?: string) {
    super(root, { idPrefix: 'RC-', currentFile: 'current' });
  }

  protected override missingCurrentMessage(): string {
    return 'No current research session';
  }

  protected override notFoundMessage(sessionId: string): string {
    return `Research session not found: ${sessionId}`;
  }
}
