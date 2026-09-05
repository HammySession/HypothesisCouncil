import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ResearchSessionStore, SessionStoreBase } from '../../src/research/store.js';
import { seedSession } from '../cli/shell/fakes.js';

interface NoteSession {
  id: string;
  updatedAt: string;
  text: string;
}

class NoteStore extends SessionStoreBase<NoteSession> {
  constructor(root: string) {
    super(root, { idPrefix: 'NT-', currentFile: 'current-note' });
  }
}

describe('session stores', () => {
  it('annotates a session without bumping updatedAt or moving the current pointer', () => {
    const store = new ResearchSessionStore(mkdtempSync(join(tmpdir(), 'hc-store-')));
    const older = seedSession(store, { id: 'RC-20260827-000000Z-aaaaaa' });
    const newer = seedSession(store, { id: 'RC-20260828-000000Z-bbbbbb' });
    expect(store.currentId()).toBe(newer.id);

    const annotated = store.updateMeta(older.id, {
      title: 'Drift',
      tags: ['cache', ' cache', 'io'],
    });
    expect(annotated.meta).toEqual({ title: 'Drift', tags: ['cache', 'io'] });
    expect(store.load(older.id).updatedAt).toBe(older.updatedAt);
    expect(store.currentId()).toBe(newer.id);

    const merged = store.updateMeta(older.id, { summary: 'Cache stalls', title: undefined });
    expect(merged.meta).toEqual({ tags: ['cache', 'io'], summary: 'Cache stalls' });
    expect(store.list().map((session) => session.id)).toEqual([newer.id, older.id]);
  });

  it('exposes artifact paths and existence', () => {
    const store = new ResearchSessionStore(mkdtempSync(join(tmpdir(), 'hc-store-')));
    const session = seedSession(store);
    expect(store.artifactExists(session.id, 'report.md')).toBe(true);
    expect(store.artifactExists(session.id, 'report.html')).toBe(false);
    expect(store.artifactPath(session.id, 'report.md')).toBe(session.reportMarkdownPath);
    expect(readFileSync(store.artifactPath(session.id, 'session.json'), 'utf8')).toContain(
      session.id
    );
  });

  it('keeps id prefixes and current pointers separate per store kind', () => {
    const root = mkdtempSync(join(tmpdir(), 'hc-store-'));
    const research = new ResearchSessionStore(root);
    const notes = new NoteStore(root);
    seedSession(research);
    const note: NoteSession = { id: notes.createId(), updatedAt: '', text: 'hello' };
    notes.save(note);

    expect(note.id).toMatch(/^NT-\d{8}-\d{6}Z-[0-9a-f]{6}$/);
    expect(notes.currentId()).toBe(note.id);
    expect(research.currentId()).toMatch(/^RC-/);
    expect(notes.list().map((item) => item.id)).toEqual([note.id]);
    expect(research.list().map((item) => item.id)).not.toContain(note.id);
    expect(() => notes.load('NT-missing')).toThrow('Session not found: NT-missing');
    expect(() => research.load('RC-missing')).toThrow('Research session not found: RC-missing');
  });
});
