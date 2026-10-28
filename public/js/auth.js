// GPA — Group Planning Assistant (GPL-2.0-only). See LICENSE.
// auth.js: login vs guest sessions, and the access-control gates.
// Rule: only logged-in users can create groups and change profile
// pictures. Anyone with a link can join as a guest with a handle.

import {
  ApiError, fetchMe, loginRemote, logoutRemote, registerRemote, setAuthToken,
} from './api.js';
import { getSession, saveSession } from './store.js';

export function currentUser() {
  return getSession().user;
}

export function isLoggedIn() {
  return currentUser() !== null;
}

export function login(name) {
  const session = getSession();
  session.user = { name: name.trim(), avatar: null };
  saveSession(session);
  return session.user;
}

export function logout() {
  const session = getSession();
  session.user = null;
  saveSession(session);
}

/**
 * Remote-mode accounts. Each resolves to the session user; failures throw
 * the server's ApiError (e.g. name taken, wrong password) for the UI.
 */
export async function registerAccount(name, password) {
  const { user, token } = await registerRemote(name.trim(), password);
  return adoptUser(user, token);
}

export async function loginAccount(name, password) {
  const { user, token } = await loginRemote(name.trim(), password);
  return adoptUser(user, token);
}

export async function logoutAccount() {
  try {
    await logoutRemote();
  } catch {
    // Token already dead — clear local state anyway.
  }
  setAuthToken(null);
  logout();
}

/**
 * Boot check: adopt the server identity for the stored token. A 401 means
 * the token expired or was never a real account — clear it. Other errors
 * (network blips) leave local state untouched.
 */
export async function refreshSessionUser() {
  const session = getSession();
  try {
    const { user } = await fetchMe();
    session.user = { name: user.name, avatar: user.avatar || null };
    saveSession(session);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      setAuthToken(null);
      session.user = null;
      saveSession(session);
    }
  }
  return getSession().user;
}

function adoptUser(user, token) {
  setAuthToken(token);
  const session = getSession();
  session.user = { name: user.name, avatar: user.avatar || null };
  saveSession(session);
  return session.user;
}

export function setUserAvatar(dataUrlOrNull) {
  if (!canChangeAvatar()) return false;
  const session = getSession();
  if (!session.user) return false;
  session.user.avatar = dataUrlOrNull;
  saveSession(session);
  return true;
}

export function guestHandle(groupId) {
  return getSession().guests[groupId] || null;
}

export function setGuestHandle(groupId, handle) {
  const session = getSession();
  session.guests[groupId] = handle.trim();
  saveSession(session);
  return session.guests[groupId];
}

/** Capability gates — check these before the action, not just the button. */
export function canCreateGroups() {
  return isLoggedIn();
}

export function canChangeAvatar() {
  return isLoggedIn();
}

/**
 * Active identity for a group: the logged-in user, else the guest handle,
 * else null (identity still needed before participating).
 */
export function identityFor(groupId) {
  const user = currentUser();
  if (user) return { name: user.name, avatar: user.avatar, kind: 'user' };
  const handle = guestHandle(groupId);
  if (handle) return { name: handle, avatar: null, kind: 'guest' };
  return null;
}
