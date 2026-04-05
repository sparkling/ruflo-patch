/**
 * FederatedSession Controller — Shared session transport
 *
 * Provides cross-agent session creation, joining, and state synchronization.
 * All storage operations route through the IMemoryBackend abstraction —
 * never calls better-sqlite3 directly.
 *
 * ADR-0068 Wave 4 stub controller.
 *
 * @module ruflo-patch/controllers/federated-session
 */

import * as crypto from 'node:crypto';

// ===== Types (mirrors @claude-flow/memory/src/types.ts contracts) =====

/** Subset of IMemoryBackend used by FederatedSession */
interface IMemoryBackend {
  store(entry: MemoryEntry): Promise<void>;
  get(id: string): Promise<MemoryEntry | null>;
  query(query: MemoryQuery): Promise<MemoryEntry[]>;
  update(id: string, update: MemoryEntryUpdate): Promise<MemoryEntry | null>;
}

interface MemoryEntry {
  id: string;
  key: string;
  content: string;
  type: string;
  namespace: string;
  tags: string[];
  metadata: Record<string, unknown>;
  accessLevel: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  references: string[];
  [k: string]: unknown;
}

interface MemoryQuery {
  type: string;
  namespace?: string;
  tags?: string[];
  limit: number;
  [k: string]: unknown;
}

interface MemoryEntryUpdate {
  content?: string;
  metadata?: Record<string, unknown>;
  [k: string]: unknown;
}

// ===== Session Types =====

export interface SessionInfo {
  sessionId: string;
  ownerId: string;
  participants: string[];
  createdAt: number;
  updatedAt: number;
  state: Record<string, unknown>;
}

export interface JoinResult {
  sessionId: string;
  joined: boolean;
  participantCount: number;
}

export interface SyncResult {
  sessionId: string;
  merged: boolean;
  conflictsResolved: number;
  updatedAt: number;
}

// ===== Constants =====

const SESSION_NAMESPACE = '_federated_sessions';
const SESSION_TAG = 'federated-session';

// ===== FederatedSession Controller =====

export class FederatedSessionController {
  private readonly backend: IMemoryBackend;

  constructor(backend: IMemoryBackend) {
    this.backend = backend;
  }

  /**
   * Create a new federated session with an initial owner.
   */
  async createSession(ownerId: string, initialState?: Record<string, unknown>): Promise<SessionInfo> {
    const sessionId = `fs-${crypto.randomUUID()}`;
    const now = Date.now();

    const session: SessionInfo = {
      sessionId,
      ownerId,
      participants: [ownerId],
      createdAt: now,
      updatedAt: now,
      state: initialState ?? {},
    };

    await this.backend.store({
      id: sessionId,
      key: `session:${sessionId}`,
      content: JSON.stringify(session),
      type: 'working',
      namespace: SESSION_NAMESPACE,
      tags: [SESSION_TAG, `owner:${ownerId}`],
      metadata: { sessionId, ownerId, participantCount: 1 },
      accessLevel: 'swarm',
      createdAt: now,
      updatedAt: now,
      version: 1,
      references: [],
    });

    return session;
  }

  /**
   * Join an existing federated session.
   */
  async joinSession(sessionId: string, agentId: string): Promise<JoinResult> {
    const entry = await this.backend.get(sessionId);
    if (!entry) {
      return { sessionId, joined: false, participantCount: 0 };
    }

    const session: SessionInfo = JSON.parse(entry.content);

    if (session.participants.includes(agentId)) {
      return { sessionId, joined: true, participantCount: session.participants.length };
    }

    session.participants.push(agentId);
    session.updatedAt = Date.now();

    await this.backend.update(sessionId, {
      content: JSON.stringify(session),
      metadata: {
        ...entry.metadata,
        participantCount: session.participants.length,
      },
    });

    return { sessionId, joined: true, participantCount: session.participants.length };
  }

  /**
   * Synchronize state into a federated session.
   * Uses last-writer-wins for conflicting keys.
   */
  async syncState(
    sessionId: string,
    agentId: string,
    patch: Record<string, unknown>,
  ): Promise<SyncResult> {
    const entry = await this.backend.get(sessionId);
    if (!entry) {
      return { sessionId, merged: false, conflictsResolved: 0, updatedAt: 0 };
    }

    const session: SessionInfo = JSON.parse(entry.content);

    // Count keys that already exist with different values (conflicts)
    let conflictsResolved = 0;
    for (const [key, value] of Object.entries(patch)) {
      if (key in session.state && session.state[key] !== value) {
        conflictsResolved++;
      }
      session.state[key] = value;
    }

    session.updatedAt = Date.now();

    await this.backend.update(sessionId, {
      content: JSON.stringify(session),
      metadata: {
        ...entry.metadata,
        lastSyncBy: agentId,
        lastSyncAt: session.updatedAt,
      },
    });

    return {
      sessionId,
      merged: true,
      conflictsResolved,
      updatedAt: session.updatedAt,
    };
  }

  /**
   * Retrieve the current session state.
   */
  async getSession(sessionId: string): Promise<SessionInfo | null> {
    const entry = await this.backend.get(sessionId);
    if (!entry) return null;
    return JSON.parse(entry.content);
  }

  /**
   * List all active federated sessions.
   */
  async listSessions(limit = 50): Promise<SessionInfo[]> {
    const entries = await this.backend.query({
      type: 'tag',
      namespace: SESSION_NAMESPACE,
      tags: [SESSION_TAG],
      limit,
    });

    return entries.map((e) => JSON.parse(e.content));
  }
}

export default FederatedSessionController;
