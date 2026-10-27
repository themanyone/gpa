// GPA — Group Planning Assistant (GPL-2.0-only). See LICENSE.
// index.ts: Worker entry — routes /api/* to GroupRoom Durable Objects.
// Static files are served from ../public without invoking this Worker.

import { GroupRoom } from "./group-room";

export { GroupRoom };

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
      "Access-Control-Allow-Headers": "Content-Type",
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

function stubFor(env: Env, id: string): DurableObjectStub<GroupRoom> {
  return env.GROUP_ROOM.getByName(id);
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
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }
    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true, time: Date.now() });
      }
      if (url.pathname === "/api/groups" && request.method === "POST") {
        const body = await readBody(request);
        const id = makeGroupId();
        try {
          const group = await stubFor(env, id).ensureGroup({
            id,
            title: String(body["title"] ?? ""),
            topic: String(body["topic"] ?? ""),
            creator: String(body["creator"] ?? ""),
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
            const members = await stub.join({
              name: String(body["name"] ?? ""),
              kind: String(body["kind"] ?? "guest"),
              avatar: typeof body["avatar"] === "string" ? body["avatar"] : null,
            });
            return json({ members });
          } catch (e) {
            return json({ error: messageOf(e) }, 404);
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
            const message = await stub.post({
              author: String(body["author"] ?? ""),
              kind: String(body["kind"] ?? ""),
              avatar: typeof body["avatar"] === "string" ? body["avatar"] : null,
              text: String(body["text"] ?? ""),
            });
            return json({ message }, 201);
          } catch (e) {
            const msg = messageOf(e);
            return json({ error: msg }, msg === "Group not found." ? 404 : 400);
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
