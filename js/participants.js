// GPA — Group Planning Assistant (GPL-2.0-only). See LICENSE.
// participants.js: renders the info-bar participant roster.

import { avatarFor } from './avatar.js';
import { getMessages } from './store.js';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * Render group members plus anyone who has posted, marking `you`.
 * AI models are listed separately (see app.js model list).
 */
export function renderParticipants(listEl, countEl, group, you) {
  const seen = new Map();
  for (const m of group.members || []) {
    if (!seen.has(m.name)) seen.set(m.name, { name: m.name, kind: m.kind, avatar: null });
  }
  for (const msg of getMessages(group.id)) {
    if (msg.kind === 'ai') continue;
    if (!seen.has(msg.author)) {
      seen.set(msg.author, { name: msg.author, kind: msg.kind, avatar: msg.avatar });
    } else if (msg.avatar && !seen.get(msg.author).avatar) {
      seen.get(msg.author).avatar = msg.avatar;
    }
  }
  const people = [...seen.values()];
  countEl.textContent = `(${people.length})`;
  listEl.innerHTML = '';
  for (const p of people) {
    const li = document.createElement('li');
    li.className = 'roster-item';
    const isYou = you && p.name === you.name;
    li.innerHTML =
      `<img class="avatar" alt="" loading="lazy">` +
      `<span class="name">${escapeHtml(p.name)}` +
      `<span class="sub">${p.kind === 'guest' ? 'guest · generic avatar' : escapeHtml(p.kind)}</span></span>` +
      (isYou ? `<span class="you-badge">you</span>` : '');
    li.querySelector('img').src = avatarFor(p);
    listEl.appendChild(li);
  }
}
