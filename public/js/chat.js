// GPA — Group Planning Assistant (GPL-2.0-only). See LICENSE.
// chat.js: message rendering, the send flow (including @AI replies),
// and the live channel subscription for the active group.

import { connectGroupSocket, isBackendAvailable, postRemote } from './api.js';
import { avatarFor } from './avatar.js';
import { askModel, findMentions } from './models.js';
import { addMessage, getMessages, uid } from './store.js';
import { ensureMember } from './groups.js';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Highlight @mentions in otherwise-escaped text. */
function renderText(text) {
  return escapeHtml(text).replace(/@([A-Za-z0-9_]+)/g, '<strong>@$1</strong>');
}

export function renderMessages(messagesEl, group, you) {
  messagesEl.innerHTML = '';
  for (const msg of getMessages(group.id)) {
    messagesEl.appendChild(messageNode(msg, you));
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function messageNode(msg, you) {
  const li = document.createElement('li');
  const own = you && msg.kind !== 'ai' && msg.author === you.name;
  li.className = 'message' + (own ? ' own' : '') + (msg.kind === 'ai' ? ' ai' : '');
  li.innerHTML =
    `<img class="avatar" alt="" loading="lazy">` +
    `<div class="body"><div class="head">` +
    `<span class="author">${escapeHtml(msg.author)}</span>` +
    (msg.kind === 'ai' ? `<span class="ai-tag">AI</span>` : '') +
    `<span class="time">${formatTime(msg.ts)}</span>` +
    `</div><div class="text">${renderText(msg.text)}</div></div>`;
  li.querySelector('img').src = msg.avatar || avatarFor({ name: msg.author });
  return li;
}

/**
 * Send a message as `identity`, then answer any @AI mentions in order.
 * Remote mode posts through the server (which assigns ids and broadcasts
 * to other clients); local mode appends to localStorage directly.
 * `onUpdate` re-renders after each new message; typing indicator callbacks
 * bracket each AI reply.
 */
export async function sendMessage(group, identity, text, hooks) {
  const clean = text.trim().slice(0, 2000);
  if (!clean) return;
  ensureMember(group, identity.name, identity.kind);
  const remote = await isBackendAvailable();

  async function publish(author, kind, avatar, msgText) {
    if (remote) {
      const { message } = await postRemote(group.id, { author, kind, avatar, text: msgText });
      addMessage(group.id, message);
    } else {
      addMessage(group.id, {
        id: uid('m'),
        author,
        kind,
        avatar: kind === 'user' ? avatar : null,
        text: msgText,
        ts: Date.now(),
      });
    }
    hooks.onUpdate();
  }

  await publish(identity.name, identity.kind, identity.avatar, clean);

  for (const model of findMentions(clean)) {
    hooks.showTyping(`@${model.handle} is thinking…`);
    try {
      const history = getMessages(group.id);
      const reply = await askModel(model, clean, history);
      await publish(`@${model.handle}`, 'ai', null, reply);
    } finally {
      hooks.hideTyping();
    }
  }
}

// Live channel for the active group. Only one subscription at a time;
// the token guards against overlapping async connects on fast switching.
let activeSocket = null;
let watchToken = 0;

export function watchGroup(groupId, hooks) {
  unwatchGroup();
  const token = ++watchToken;
  isBackendAvailable().then((remote) => {
    if (!remote || token !== watchToken) return;
    const close = connectGroupSocket(groupId, {
      onMessage: (message) => {
        addMessage(groupId, message);
        hooks.onUpdate();
      },
    });
    activeSocket = { groupId, close };
  });
}

export function unwatchGroup() {
  watchToken += 1;
  if (activeSocket) {
    activeSocket.close();
    activeSocket = null;
  }
}
