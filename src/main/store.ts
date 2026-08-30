import type { SessionSnapshot, SubtitleSegment } from '../shared/types';

interface StoreShape { sessions: SessionSnapshot[] }

export class SessionStore {
  private data: StoreShape = { sessions: [] };

  async initialize() { this.data = { sessions: [] }; }

  list() { return [...this.data.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }
  get(id: string) { return this.data.sessions.find((item) => item.id === id); }

  async put(session: SessionSnapshot) {
    const index = this.data.sessions.findIndex((item) => item.id === session.id);
    if (index >= 0) this.data.sessions[index] = session; else this.data.sessions.push(session);
  }

  async putSegment(sessionId: string, incoming: SubtitleSegment) {
    const session = this.get(sessionId);
    if (!session) throw new Error('会话不存在');
    const index = session.segments.findIndex((item) => item.id === incoming.id);
    if (index >= 0) {
      const current = session.segments[index];
      if (incoming.version <= current.version || current.state === 'stable' && incoming.state === 'partial') return current;
      session.segments[index] = incoming;
    } else session.segments.push(incoming);
    session.segments.sort((a, b) => a.startMs - b.startMs);
    return incoming;
  }
}
