// GPA — Group Planning Assistant (GPL-2.0-only). See LICENSE.
// groups.js: create/resolve groups and build invite links.
// With a backend available, groups live on the server and localStorage
// acts as a read cache; otherwise everything stays fully local.

import { createRemoteGroup, fetchRemoteState, isBackendAvailable } from './api.js';
import { canCreateGroups } from './auth.js';
import { getGroup, listGroups, saveGroup, saveMessages, uid } from './store.js';

export async function createGroup(title, topic, authorName) {
  if (!canCreateGroups()) {
    throw new Error('Only logged-in users can create groups.');
  }
  if (await isBackendAvailable()) {
    const { group } = await createRemoteGroup({
      title: title.trim(),
      topic: (topic || '').trim(),
      creator: authorName,
    });
    return saveGroup(fromRemote(group));
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

/** Ensure someone who posted is listed as a group member (local cache). */
export function ensureMember(group, name, kind) {
  if (!group.members.some((m) => m.name === name)) {
    group.members.push({ name, kind });
    saveGroup(group);
  }
  return group;
}

/** Pull server state into the local cache. Returns the group or null. */
export async function syncGroupFromServer(groupId) {
  const state = await fetchRemoteState(groupId);
  if (!state) return null;
  saveMessages(groupId, state.messages);
  return saveGroup(fromRemote(state.group));
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
export async function resolveActiveGroup() {
  const fromUrl = groupIdFromUrl();
  if (fromUrl) {
    if (await isBackendAvailable()) {
      const synced = await syncGroupFromServer(fromUrl);
      if (synced) return synced;
    }
    return getGroup(fromUrl);
  }
  const groups = listGroups();
  return groups.length > 0 ? groups[0] : null;
}

export function setUrlGroup(groupId) {
  const url = new URL(window.location.href);
  url.searchParams.set('g', groupId);
  window.history.replaceState(null, '', url);
}

function fromRemote(group) {
  return {
    id: group.id,
    title: group.title,
    topic: group.topic || '',
    members: (group.members || []).map((m) => ({ name: m.name, kind: m.kind, avatar: m.avatar || null })),
    createdBy: group.createdBy,
    createdAt: group.createdAt,
  };
}
