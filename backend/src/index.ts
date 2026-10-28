// GPA — Group Planning Assistant (GPL-2.0-only). See LICENSE.
// index.ts: Worker entry — routes /api/* to Durable Objects.
// Static files are served from ../public without invoking this Worker.
// Identity: authenticated users act via Bearer session tokens (verified
// against AuthStore); unauthenticated callers can only read or join/post
// as guests, and never under a registered name.

import { AuthStore } from "./auth-store";
import { GroupRoom } from "./group-room";

export { AuthStore, GroupRoom };

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function makeGroupId(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await request.json();
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
    return {};
  } catch {
    throw BadRequest("Invalid JSON body.");
  }
}

function BadRequest(message: string): Error & { status?: number } {
  return Object.assign(new Error(message), { status: 400 });
}

function httpError(message: string, status: number): Error & { status?: number } {
  return Object.assign(new Error(message), { status });
}

function errStatus(e: unknown): number | null {
  const status = (e as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function stubFor(env: Env, id: string): DurableObjectStub<GroupRoom> {
  return env.GROUP_ROOM.getByName(id);
}

function authStub(env: Env): DurableObjectStub<AuthStore> {
  return env.AUTH_STORE.getByName("global");
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  const token = match ? match[1].trim() : "";
  return token.length > 0 ? token : null;
}

/**
 * Resolve who the caller acts as. Authenticated users always act as
 * themselves (client name/kind/avatar claims are ignored). Everyone else
 * acts as a guest with a generic avatar — or posts an AI reply when the
 * route allows it (the browser demo stub; the model slice moves this
 * server-side). `nameKey` is the body's identity field ("name" or "author").
 */
async function resolveIdentity(
  env: Env,
  request: Request,
  body: Record<string, unknown>,
  nameKey: string,
  allowAi: boolean,
): Promise<{ name: string; kind: string; avatar: string | null }> {
  const claimedKind = String(body["kind"] ?? "guest");
  if (claimedKind === "ai" && allowAi) {
    return { name: String(body[nameKey] ?? ""), kind: "ai", avatar: null };
  }
  const token = bearerToken(request);
  const me = token ? await authStub(env).verify(token) : null;
  if (me) return { name: me.name, kind: "user", avatar: me.avatar };
  if (claimedKind === "user") throw httpError("Log in to act as a user.", 401);
  const name = String(body[nameKey] ?? "");
  if (await authStub(env).isRegistered(name)) {
    throw httpError("That name belongs to a registered account. Log in to use it.", 403);
  }
  return { name, kind: "guest", avatar: null };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    console.log(JSON.stringify({ message: "request", method: request.method, path: url.pathname }));
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }
    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true, time: Date.now() });
      }
      if (url.pathname === "/api/auth/register" && request.method === "POST") {
        const body = await readBody(request);
        try {
          const result = await authStub(env).register(
            String(body["name"] ?? ""),
            String(body["password"] ?? ""),
          );
          return json(result, 201);
        } catch (e) {
          const msg = messageOf(e);
          return json({ error: msg }, msg === "Name is already taken." ? 409 : 400);
        }
      }
      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        const body = await readBody(request);
        try {
          const result = await authStub(env).login(
            String(body["name"] ?? ""),
            String(body["password"] ?? ""),
          );
          return json(result);
        } catch (e) {
          const msg = messageOf(e);
          return json({ error: msg }, msg === "Invalid name or password." ? 401 : 400);
        }
      }
      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        const token = bearerToken(request);
        if (token) await authStub(env).logout(token);
        return json({ ok: true });
      }
      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        const token = bearerToken(request);
        const user = token ? await authStub(env).verify(token) : null;
        if (!user) return json({ error: "Not logged in." }, 401);
        return json({ user });
      }
      if (url.pathname === "/api/auth/avatar" && request.method === "POST") {
        const token = bearerToken(request);
        const user = token ? await authStub(env).verify(token) : null;
        if (!user) return json({ error: "Log in to change your profile picture." }, 401);
        const body = await readBody(request);
        try {
          const updated = await authStub(env).setAvatar(
            user.name,
            typeof body["avatar"] === "string" ? body["avatar"] : null,
          );
          return json({ user: updated });
        } catch (e) {
          return json({ error: messageOf(e) }, 400);
        }
      }
      if (url.pathname === "/api/groups" && request.method === "POST") {
        const token = bearerToken(request);
        const me = token ? await authStub(env).verify(token) : null;
        if (!me) return json({ error: "Log in to create groups." }, 401);
        const body = await readBody(request);
        const id = makeGroupId();
        try {
          const group = await stubFor(env, id).ensureGroup({
            id,
            title: String(body["title"] ?? ""),
            topic: String(body["topic"] ?? ""),
            creator: me.name,
          });
          return json({ group }, 201);
        } catch (e) {
          return json({ error: messageOf(e) }, 400);
        }
      }
      const match = /^\/api\/groups\/([^/]+)(\/.*)?$/.exec(url.pathname);
      if (match) {
        const [, id, rest] = match;
        const stub = stubFor(env, id);
        if ((rest === "" || rest === undefined) && request.method === "GET") {
          const state = await stub.getState();
          if (!state) return json({ error: "Group not found." }, 404);
          return json(state);
        }
        if (rest === "/join" && request.method === "POST") {
          const body = await readBody(request);
          try {
            const identity = await resolveIdentity(env, request, body, "name", false);
            const members = await stub.join({
              name: identity.name,
              kind: identity.kind,
              avatar: identity.avatar,
            });
            return json({ members });
          } catch (e) {
            const msg = messageOf(e);
            return json({ error: msg }, errStatus(e) ?? (msg === "Group not found." ? 404 : 400));
          }
        }
        if (rest === "/messages" && request.method === "GET") {
          const since = Number(url.searchParams.get("since") ?? 0) || 0;
          try {
            const messages = await stub.listMessages(since);
            return json({ messages });
          } catch (e) {
            return json({ error: messageOf(e) }, 404);
          }
        }
        if (rest === "/messages" && request.method === "POST") {
          const body = await readBody(request);
          try {
            const identity = await resolveIdentity(env, request, body, "author", true);
            const message = await stub.post({
              author: identity.name,
              kind: identity.kind,
              avatar: identity.avatar,
              text: String(body["text"] ?? ""),
            });
            return json({ message }, 201);
          } catch (e) {
            const msg = messageOf(e);
            return json({ error: msg }, errStatus(e) ?? (msg === "Group not found." ? 404 : 400));
          }
        }
        if (rest === "/ws" && request.headers.get("Upgrade") === "websocket") {
          return stub.fetch(request);
        }
      }
      return json({ error: "Not found." }, 404);
    } catch (e) {
      const err = e as Error & { status?: number };
      console.error(JSON.stringify({ message: "request failed", error: err.message }));
      return json({ error: err.message || "Internal error." }, err.status ?? 500);
    }
  },
} satisfies ExportedHandler<Env>;

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
