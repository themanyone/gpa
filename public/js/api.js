// GPA — Group Planning Assistant (GPL-2.0-only). See LICENSE.
// api.js: remote backend client (Cloudflare Worker + Durable Objects).
// Same-origin /api by default; override with ?api=<base> or the
// gpa.apiBase localStorage key. When no backend answers, the app runs
// fully offline against localStorage (see store.js).

const LS_KEY = 'gpa.apiBase';
const PROBE_TIMEOUT_MS = 2500;

export function apiBase() {
  const fromQuery = new URLSearchParams(window.location.search).get('api');
  if (fromQuery) return fromQuery.replace(/\/$/, '');
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) return saved.replace(/\/$/, '');
  } catch {
    // Storage unavailable — fall through to same-origin.
  }
  return '';
}

let cachedAvailable = null;

/** Probe /api/health once; result is cached for the session. */
export async function isBackendAvailable() {
  if (cachedAvailable !== null) return cachedAvailable;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`${apiBase()}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    cachedAvailable = res.ok;
  } catch {
    cachedAvailable = false;
  }
  return cachedAvailable;
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function req(path, { method = 'GET', body = null } = {}) {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : null,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    // Non-JSON error body — fall through to generic message.
  }
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status}).`);
  return data;
}

/** Create a group on the server. Returns {group}. */
export function createRemoteGroup({ title, topic, creator }) {
  return req('/api/groups', { method: 'POST', body: { title, topic, creator } });
}

/** Fetch group + messages. Returns {group, messages}, or null when missing. */
export async function fetchRemoteState(id) {
  try {
    return await req(`/api/groups/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Register membership on the server. Returns {members}. */
export function joinRemote(id, { name, kind, avatar }) {
  return req(`/api/groups/${encodeURIComponent(id)}/join`, {
    method: 'POST',
    body: { name, kind, avatar: avatar || null },
  });
}

/** Post a message; the server broadcasts it to all attached clients. */
export function postRemote(id, { author, kind, avatar, text }) {
  return req(`/api/groups/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    body: { author, kind, avatar: avatar || null, text },
  });
}

function socketUrl(id) {
  const base = apiBase();
  const path = `/api/groups/${encodeURIComponent(id)}/ws`;
  if (!base) {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${window.location.host}${path}`;
  }
  return base.replace(/^http/, 'ws') + path;
}

/**
 * Open the group's live channel. onMessage receives each broadcast
 * ChatMessage. Returns a close() function; reconnects with backoff
 * until explicitly closed.
 */
export function connectGroupSocket(id, { onMessage, onStatus }) {
  let socket = null;
  let closed = false;
  let attempts = 0;
  let timer = 0;

  function open() {
    if (closed) return;
    socket = new WebSocket(socketUrl(id));
    socket.onopen = () => {
      attempts = 0;
      if (onStatus) onStatus(true);
    };
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data && data.type === 'message' && data.message) onMessage(data.message);
      } catch {
        // Ignore malformed frames.
      }
    };
    socket.onclose = () => {
      socket = null;
      if (onStatus) onStatus(false);
      if (closed) return;
      attempts += 1;
      if (attempts > 8) return;
      timer = setTimeout(open, Math.min(1000 * 2 ** attempts, 15000));
    };
  }

  open();
  return function close() {
    closed = true;
    clearTimeout(timer);
    if (socket) socket.close();
  };
}
