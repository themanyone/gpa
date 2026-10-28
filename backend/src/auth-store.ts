// GPA — Group Planning Assistant (GPL-2.0-only). See LICENSE.
// auth-store.ts: global account registry + sessions (one DO instance).
// Passwords use PBKDF2-SHA256 with a per-user salt and constant-time
// compare. Sessions are opaque random tokens with a 30-day expiry, so
// no signing secret is needed. Account names are unique
// case-insensitively; guests may not use a registered name.

import { DurableObject } from "cloudflare:workers";

export interface AccountUser {
  name: string;
  avatar: string | null;
}

const MAX_NAME = 40;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const MAX_AVATAR = 200_000; // data-URL uploads stay small
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const PBKDF2_ITERATIONS = 120_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t.length === 0 || t.length > MAX_NAME) return null;
  return t;
}

function cleanPassword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length < MIN_PASSWORD || value.length > MAX_PASSWORD) return null;
  return value;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function unhex(s: string): Uint8Array | null {
  if (s.length % 2 !== 0 || !/^[0-9a-f]*$/.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Constant-time equality over decoded hashes (no early exit). */
function hashesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hashPassword(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    key,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

type Row = Record<string, unknown>;

export class AuthStore extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const sql = this.ctx.storage.sql;
      sql.exec(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        pass_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        avatar TEXT,
        created_at INTEGER NOT NULL
      )`);
      sql.exec(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`);
      sql.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)`);
    });
  }

  async register(name: string, password: string): Promise<{ user: AccountUser; token: string }> {
    const clean = cleanName(name);
    const pw = cleanPassword(password);
    if (!clean) throw new Error("Invalid display name.");
    if (!pw) throw new Error(`Password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters.`);
    const id = clean.toLowerCase();
    const sql = this.ctx.storage.sql;
    const exists = sql.exec("SELECT id FROM users WHERE id = ?", id).toArray();
    if (exists.length > 0) throw new Error("Name is already taken.");
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const hash = await hashPassword(pw, salt);
    const now = Date.now();
    sql.exec(
      "INSERT INTO users (id, name, pass_hash, salt, avatar, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
      id,
      clean,
      hex(hash),
      hex(salt),
      now,
    );
    return { user: { name: clean, avatar: null }, token: this.mintSession(id, now) };
  }

  async login(name: string, password: string): Promise<{ user: AccountUser; token: string }> {
    const clean = cleanName(name);
    const sql = this.ctx.storage.sql;
    // Generic message either way: don't reveal whether the name exists.
    if (!clean || typeof password !== "string") throw new Error("Invalid name or password.");
    const rows = sql.exec("SELECT * FROM users WHERE id = ?", clean.toLowerCase()).toArray() as unknown as Row[];
    const row = rows[0];
    const salt = row ? unhex(String(row["salt"] ?? "")) : null;
    const expected = row ? unhex(String(row["pass_hash"] ?? "")) : null;
    if (!row || !salt || !expected) throw new Error("Invalid name or password.");
    const actual = await hashPassword(password, salt);
    if (!hashesEqual(actual, expected)) throw new Error("Invalid name or password.");
    return {
      user: { name: row["name"] as string, avatar: (row["avatar"] as string | null) ?? null },
      token: this.mintSession(row["id"] as string, Date.now()),
    };
  }

  async verify(token: string): Promise<AccountUser | null> {
    if (typeof token !== "string" || token.length === 0) return null;
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM sessions WHERE expires_at <= ?", Date.now());
    const rows = sql.exec(
      `SELECT u.name AS name, u.avatar AS avatar FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
      token,
    ).toArray() as unknown as Row[];
    if (rows.length === 0) return null;
    return { name: rows[0]["name"] as string, avatar: (rows[0]["avatar"] as string | null) ?? null };
  }

  async logout(token: string): Promise<void> {
    if (typeof token !== "string" || token.length === 0) return;
    this.ctx.storage.sql.exec("DELETE FROM sessions WHERE token = ?", token);
  }

  async isRegistered(name: string): Promise<boolean> {
    const clean = cleanName(name);
    if (!clean) return false;
    const rows = this.ctx.storage.sql.exec(
      "SELECT id FROM users WHERE id = ?",
      clean.toLowerCase(),
    ).toArray();
    return rows.length > 0;
  }

  /** Set an account avatar. Callers pass a server-verified name. */
  async setAvatar(name: string, avatar: string | null): Promise<AccountUser> {
    const clean = cleanName(name);
    if (!clean) throw new Error("Invalid display name.");
    const next = typeof avatar === "string" && avatar.length <= MAX_AVATAR ? avatar : null;
    const sql = this.ctx.storage.sql;
    sql.exec("UPDATE users SET avatar = ? WHERE id = ?", next, clean.toLowerCase());
    const rows = sql.exec("SELECT name, avatar FROM users WHERE id = ?", clean.toLowerCase()).toArray() as unknown as Row[];
    if (rows.length === 0) throw new Error("Account not found.");
    return { name: rows[0]["name"] as string, avatar: (rows[0]["avatar"] as string | null) ?? null };
  }

  private mintSession(userId: string, now: number): string {
    const token = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      token,
      userId,
      now,
      now + SESSION_TTL_MS,
    );
    return token;
  }
}
