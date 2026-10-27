// GPA — Group Planning Assistant (GPL-2.0-only). See LICENSE.
// store.js: localStorage persistence for groups, messages, and session.
// Shape notes: group = {id,title,topic,members:[{name,kind}],createdBy,createdAt}
// message = {id,author,kind:'user'|'guest'|'ai',avatar,text,ts}

const KEYS = {
  groups: 'gpa.groups.v1',
  messages: 'gpa.messages.v1',
  session: 'gpa.session.v1',
};

export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function uid(prefix) {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function listGroups() {
  return loadJSON(KEYS.groups, []);
}

export function getGroup(id) {
  return listGroups().find((g) => g.id === id) || null;
}

export function saveGroup(group) {
  const groups = listGroups();
  const i = groups.findIndex((g) => g.id === group.id);
  if (i >= 0) groups[i] = group;
  else groups.push(group);
  saveJSON(KEYS.groups, groups);
  return group;
}

export function getMessages(groupId) {
  const all = loadJSON(KEYS.messages, {});
  return all[groupId] || [];
}

export function addMessage(groupId, message) {
  const all = loadJSON(KEYS.messages, {});
  const list = all[groupId] || [];
  list.push(message);
  all[groupId] = list;
  saveJSON(KEYS.messages, all);
  return message;
}

/** session = {user: {name,avatar} | null, guests: {groupId: handle}} */
export function getSession() {
  const s = loadJSON(KEYS.session, null);
  if (s && typeof s === 'object') {
    return { user: s.user || null, guests: s.guests || {} };
  }
  return { user: null, guests: {} };
}

export function saveSession(session) {
  saveJSON(KEYS.session, session);
}

/** Seed a demo group on first run so the UI is explorable offline. */
export function seedIfEmpty() {
  if (listGroups().length > 0) return;
  const now = Date.now();
  const group = {
    id: 'demo-weekend-trip',
    title: 'Weekend Trip',
    topic: 'Planning a weekend getaway — everyone is welcome to chime in.',
    members: [
      { name: 'Ava', kind: 'user' },
      { name: 'marc_guest', kind: 'guest' },
    ],
    createdBy: 'Ava',
    createdAt: now - 86400000,
  };
  saveGroup(group);
  const seed = [
    { author: 'Ava', kind: 'user', text: 'OK team, weekend trip: coast or mountains? We need to decide by Friday.', ts: now - 7200000 },
    { author: 'marc_guest', kind: 'guest', text: 'Coast! I found cabins near the beach that sleep 6.', ts: now - 5400000 },
    { author: 'Ava', kind: 'user', text: '@planner what should we budget for 6 people, 2 nights at the coast?', ts: now - 5000000 },
    { author: '@planner', kind: 'ai', text: 'For 6 people / 2 nights at the coast, plan roughly: lodging (one cabin) 60%, food 25%, activities + fuel 15%. Ask me for a day-by-day plan once you pick dates!', ts: now - 4900000 },
  ];
  seed.forEach((m, i) => addMessage(group.id, { id: `seed-${i}`, avatar: null, ...m }));
}
