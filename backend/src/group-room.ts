// GPA — Group Planning Assistant (GPL-2.0-only). See LICENSE.
// group-room.ts: one Durable Object per group chat — members, messages,
// and live fan-out over hibernatable WebSockets.
// Identity is enforced by the Worker entry (index.ts), which resolves the
// caller against AuthStore before invoking these methods.

import { DurableObject } from "cloudflare:workers";

export interface ChatMessage {
  id: string;
  author: string;
  kind: "user" | "guest" | "ai";
  avatar: string | null;
  text: string;
  ts: number;
}

export interface Member {
  name: string;
  kind: "user" | "guest";
  avatar: string | null;
  joinedAt: number;
}

export interface GroupInfo {
  id: string;
  title: string;
  topic: string;
  members: Member[];
  createdBy: string;
  createdAt: number;
}

const MAX_TITLE = 80;
const MAX_TOPIC = 140;
const MAX_NAME = 40;
const MAX_TEXT = 2000;
const MAX_AVATAR = 200_000; // data-URL uploads stay small
const HISTORY_LIMIT = 500;

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t.length === 0 || t.length > max) return null;
  return t;
}

function asMembers(rows: Record<string, unknown>[]): Member[] {
  return rows.map((r) => ({
    name: r["name"] as string,
    kind: r["kind"] as "user" | "guest",
    avatar: (r["avatar"] as string | null) ?? null,
    joinedAt: r["joined_at"] as number,
  }));
}

function asMessages(rows: Record<string, unknown>[]): ChatMessage[] {
  return rows.map((r) => ({
    id: r["id"] as string,
    author: r["author"] as string,
    kind: r["kind"] as ChatMessage["kind"],
    avatar: (r["avatar"] as string | null) ?? null,
    text: r["text"] as string,
    ts: r["ts"] as number,
  }));
}

export class GroupRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const sql = this.ctx.storage.sql;
      sql.exec(`CREATE TABLE IF NOT EXISTS meta (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        topic TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`);
      sql.exec(`CREATE TABLE IF NOT EXISTS members (
        name TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        avatar TEXT,
        joined_at INTEGER NOT NULL
      )`);
      sql.exec(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        author TEXT NOT NULL,
        kind TEXT NOT NULL,
        avatar TEXT,
        text TEXT NOT NULL,
        ts INTEGER NOT NULL
      )`);
      sql.exec(`CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages (ts)`);
    });
  }

  async getState(): Promise<{ group: GroupInfo; messages: ChatMessage[] } | null> {
    const sql = this.ctx.storage.sql;
    const meta = sql.exec("SELECT * FROM meta LIMIT 1").toArray() as unknown as Record<string, unknown>[];
    if (meta.length === 0) return null;
    const m = meta[0];
    const members = asMembers(
      sql.exec("SELECT * FROM members ORDER BY joined_at ASC").toArray() as unknown as Record<string, unknown>[],
    );
    const messages = asMessages(
      sql.exec("SELECT * FROM messages ORDER BY ts ASC LIMIT ?", HISTORY_LIMIT).toArray() as unknown as Record<string, unknown>[],
    );
    return {
      group: {
        id: m["id"] as string,
        title: m["title"] as string,
        topic: (m["topic"] as string) ?? "",
        members,
        createdBy: m["created_by"] as string,
        createdAt: m["created_at"] as number,
      },
      messages,
    };
  }

  async ensureGroup(input: { id: string; title: string; topic: string; creator: string }): Promise<GroupInfo> {
    const title = clean(input.title, MAX_TITLE);
    const creator = clean(input.creator, MAX_NAME);
    const topic = typeof input.topic === "string" ? input.topic.trim().slice(0, MAX_TOPIC) : "";
    if (!title || !creator) throw new Error("Invalid title or creator name.");
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO meta (id, title, topic, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
      input.id,
      title,
      topic,
      creator,
      now,
    );
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO members (name, kind, avatar, joined_at) VALUES (?, 'user', NULL, ?)",
      creator,
      now,
    );
    const state = await this.getState();
    if (!state) throw new Error("Group could not be created.");
    return state.group;
  }

  async join(input: { name: string; kind?: string; avatar?: string | null }): Promise<Member[]> {
    const state = await this.getState();
    if (!state) throw new Error("Group not found.");
    const name = clean(input.name, MAX_NAME);
    if (!name) throw new Error("Invalid handle.");
    const kind = input.kind === "user" ? "user" : "guest";
    const avatar =
      typeof input.avatar === "string" && input.avatar.length <= MAX_AVATAR ? input.avatar : null;
    this.ctx.storage.sql.exec(
      `INSERT INTO members (name, kind, avatar, joined_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET kind = excluded.kind,
         avatar = COALESCE(excluded.avatar, members.avatar)`,
      name,
      kind,
      avatar,
      Date.now(),
    );
    return (await this.getState())?.group.members ?? [];
  }

  async post(input: {
    author: string;
    kind: string;
    avatar?: string | null;
    text: string;
  }): Promise<ChatMessage> {
    const state = await this.getState();
    if (!state) throw new Error("Group not found.");
    const author = clean(input.author, MAX_NAME);
    const text = clean(input.text, MAX_TEXT);
    const kind = input.kind === "user" || input.kind === "guest" || input.kind === "ai" ? input.kind : null;
    const avatar =
      typeof input.avatar === "string" && input.avatar.length <= MAX_AVATAR ? input.avatar : null;
    if (!author || !text || !kind) throw new Error("Invalid message.");
    const sql = this.ctx.storage.sql;
    if (kind !== "ai") {
      sql.exec("INSERT OR IGNORE INTO members (name, kind, avatar, joined_at) VALUES (?, ?, ?, ?)", author, kind, avatar, Date.now());
    }
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      author,
      kind,
      avatar,
      text,
      ts: Date.now(),
    };
    sql.exec("INSERT INTO messages (id, author, kind, avatar, text, ts) VALUES (?, ?, ?, ?, ?, ?)",
      message.id, message.author, message.kind, message.avatar, message.text, message.ts);
    this.broadcast(message);
    return message;
  }

  async listMessages(since = 0): Promise<ChatMessage[]> {
    const rows = this.ctx.storage.sql.exec(
      "SELECT * FROM messages WHERE ts > ? ORDER BY ts ASC LIMIT ?",
      since,
      HISTORY_LIMIT,
    ).toArray() as unknown as Record<string, unknown>[];
    return asMessages(rows);
  }

  /** Upgrade endpoint: the Worker forwards WebSocket requests here. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade.", { status: 426 });
    }
    const state = await this.getState();
    if (!state) return new Response("Group not found.", { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === "ping") ws.send("pong");
  }

  async webSocketClose(): Promise<void> {
    // Hibernation API tracks sockets; nothing to clean up.
  }

  async webSocketError(): Promise<void> {
    // Broken sockets are dropped from future broadcasts automatically.
  }

  private broadcast(message: ChatMessage): void {
    const payload = JSON.stringify({ type: "message", message });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // Drop broken sockets; close handler state stays consistent.
      }
    }
  }
}
