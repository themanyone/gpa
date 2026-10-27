// GPA — Group Planning Assistant (GPL-2.0-only). See LICENSE.
// chat.js: message rendering and the send flow (including @AI replies).

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
 * `onUpdate` re-renders after each new message; typing indicator callbacks
 * bracket each AI reply.
 */
export async function sendMessage(group, identity, text, hooks) {
  const clean = text.trim();
  if (!clean) return;
  ensureMember(group, identity.name, identity.kind);
  const mine = addMessage(group.id, {
    id: uid('m'),
    author: identity.name,
    kind: identity.kind,
    avatar: identity.kind === 'user' ? identity.avatar : null,
    text: clean.slice(0, 2000),
    ts: Date.now(),
  });
  hooks.onUpdate();

  for (const model of findMentions(clean)) {
    hooks.showTyping(`@${model.handle} is thinking…`);
    try {
      const history = getMessages(group.id);
      const question = clean;
      const reply = await askModel(model, question, history);
      addMessage(group.id, {
        id: uid('m'),
        author: `@${model.handle}`,
        kind: 'ai',
        avatar: null,
        text: reply,
        ts: Date.now(),
      });
      hooks.onUpdate();
    } finally {
      hooks.hideTyping();
    }
  }
  return mine;
}
