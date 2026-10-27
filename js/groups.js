// GPA — Group Planning Assistant (GPL-2.0-only). See LICENSE.
// groups.js: create/resolve groups and build invite links.

import { canCreateGroups } from './auth.js';
import { getGroup, listGroups, saveGroup, uid } from './store.js';

export function createGroup(title, topic, authorName) {
  if (!canCreateGroups()) {
    throw new Error('Only logged-in users can create groups.');
  }
  const group = {
    id: uid('g'),
    title: title.trim(),
    topic: (topic || '').trim(),
    members: [{ name: authorName, kind: 'user' }],
    createdBy: authorName,
    createdAt: Date.now(),
  };
  return saveGroup(group);
}

/** Ensure someone who posted is listed as a group member. */
export function ensureMember(group, name, kind) {
  if (!group.members.some((m) => m.name === name)) {
    group.members.push({ name, kind });
    saveGroup(group);
  }
  return group;
}

/** Invite link: anybody opening it can join as a guest with a handle. */
export function inviteLink(groupId) {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('g', groupId);
  return url.toString();
}

export function groupIdFromUrl() {
  return new URLSearchParams(window.location.search).get('g');
}

/** Resolve the active group: URL param wins, else first group, else null. */
export function resolveActiveGroup() {
  const fromUrl = groupIdFromUrl();
  if (fromUrl) return getGroup(fromUrl);
  const groups = listGroups();
  return groups.length > 0 ? groups[0] : null;
}

export function setUrlGroup(groupId) {
  const url = new URL(window.location.href);
  url.searchParams.set('g', groupId);
  window.history.replaceState(null, '', url);
}
