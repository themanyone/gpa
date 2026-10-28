// GPA — Group Planning Assistant (GPL-2.0-only). See LICENSE.
// app.js: entry point — wires dialogs, info bar, chat, and access control.

import { isBackendAvailable, joinRemote, setRemoteAvatar } from './api.js';
import {
  canChangeAvatar, canCreateGroups, currentUser, identityFor,
  login, loginAccount, logout, logoutAccount, refreshSessionUser,
  registerAccount, setGuestHandle, setUserAvatar,
} from './auth.js';
import { avatarFor, genericAvatar } from './avatar.js';
import { renderMessages, sendMessage, unwatchGroup, watchGroup } from './chat.js';
import { createGroup, groupIdFromUrl, inviteLink, resolveActiveGroup, setUrlGroup, syncGroupFromServer } from './groups.js';
import { AI_MODELS } from './models.js';
import { renderParticipants } from './participants.js';
import { getGroup, listGroups, saveGroup, seedIfEmpty } from './store.js';

const $ = (id) => document.getElementById(id);

const els = {
  groupSelect: $('groupSelect'),
  newGroupBtn: $('newGroupBtn'),
  inviteBtn: $('inviteBtn'),
  authArea: $('authArea'),
  groupTitle: $('groupTitle'),
  groupTopic: $('groupTopic'),
  messages: $('messages'),
  typing: $('typing'),
  composer: $('composer'),
  messageInput: $('messageInput'),
  composerNote: $('composerNote'),
  participantList: $('participantList'),
  participantCount: $('participantCount'),
  modelList: $('modelList'),
  appearanceNote: $('appearanceNote'),
  loginDialog: $('loginDialog'),
  loginForm: $('loginForm'),
  loginName: $('loginName'),
  loginSub: $('loginSub'),
  loginPasswordRow: $('loginPasswordRow'),
  loginPassword: $('loginPassword'),
  loginModeToggle: $('loginModeToggle'),
  loginSubmit: $('loginSubmit'),
  handleDialog: $('handleDialog'),
  handleForm: $('handleForm'),
  handleName: $('handleName'),
  groupDialog: $('groupDialog'),
  groupForm: $('groupForm'),
  groupName: $('groupName'),
  groupTopicInput: $('groupTopicInput'),
  avatarDialog: $('avatarDialog'),
  avatarForm: $('avatarForm'),
  avatarFile: $('avatarFile'),
  avatarPreview: $('avatarPreview'),
  avatarReset: $('avatarReset'),
};

let activeGroup = null;
let pendingAvatar = null; // data URL staged in the avatar dialog
let remoteMode = false;
let loginMode = 'login'; // login dialog: 'login' | 'register' (remote only)

init();

async function init() {
  remoteMode = await isBackendAvailable();
  if (remoteMode) await refreshSessionUser();
  else seedIfEmpty();
  configureLoginDialog();
  activeGroup = await resolveActiveGroup();
  wireStatic();
  renderAll();
  await ensureRemoteMembership();
  renderAll();
  // Invite flow: guest with a link but no identity picks a handle to join.
  if (activeGroup && !identityFor(activeGroup.id)) {
    els.handleName.value = '';
    els.handleDialog.showModal();
  }
}

/** Register the current identity's membership on the server (remote only). */
async function ensureRemoteMembership() {
  if (!remoteMode || !activeGroup) return;
  const me = identityFor(activeGroup.id);
  if (!me) return;
  try {
    const { members } = await joinRemote(activeGroup.id, {
      name: me.name,
      kind: me.kind,
      avatar: me.avatar || null,
    });
    activeGroup.members = members.map((m) => ({ name: m.name, kind: m.kind, avatar: m.avatar || null }));
    saveGroup(activeGroup);
  } catch {
    // Server unreachable mid-session: local state stands.
  }
}

function wireStatic() {
  els.groupSelect.addEventListener('change', async () => {
    activeGroup = getGroup(els.groupSelect.value);
    if (activeGroup) {
      setUrlGroup(activeGroup.id);
      if (remoteMode) {
        try {
          await syncGroupFromServer(activeGroup.id);
        } catch {
          // Keep local cache on sync failure.
        }
        activeGroup = getGroup(activeGroup.id);
      }
    }
    renderAll();
    await ensureRemoteMembership();
    renderAll();
    if (activeGroup && !identityFor(activeGroup.id)) els.handleDialog.showModal();
  });

  els.newGroupBtn.addEventListener('click', () => {
    if (!canCreateGroups()) {
      alert('Log in to create a group. Guests can join via an invite link.');
      openLoginDialog();
      return;
    }
    els.groupForm.reset();
    els.groupDialog.showModal();
  });

  els.inviteBtn.addEventListener('click', async () => {
    if (!activeGroup) return;
    try {
      await navigator.clipboard.writeText(inviteLink(activeGroup.id));
      els.inviteBtn.textContent = 'Copied!';
    } catch {
      prompt('Copy this invite link:', inviteLink(activeGroup.id));
      return;
    }
    setTimeout(() => { els.inviteBtn.textContent = 'Copy invite link'; }, 1500);
  });

  els.composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const me = activeGroup && identityFor(activeGroup.id);
    if (!activeGroup || !me) {
      els.handleDialog.showModal();
      return;
    }
    const text = els.messageInput.value;
    els.messageInput.value = '';
    sendMessage(activeGroup, me, text, {
      onUpdate: () => renderChat(),
      showTyping: (t) => { els.typing.textContent = t; els.typing.hidden = false; },
      hideTyping: () => { els.typing.hidden = true; },
    }).catch((err) => {
      els.messageInput.value = text;
      alert(`Could not send message: ${err.message || err}`);
    });
  });

  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      if (!remoteMode) {
        login(els.loginName.value);
      } else if (loginMode === 'register') {
        await registerAccount(els.loginName.value, els.loginPassword.value);
      } else {
        await loginAccount(els.loginName.value, els.loginPassword.value);
      }
    } catch (err) {
      alert(err.message || 'Could not log in.');
      return;
    }
    els.loginPassword.value = '';
    els.loginDialog.close();
    await ensureRemoteMembership();
    renderAll();
  });

  els.loginModeToggle.addEventListener('click', () => {
    setLoginMode(loginMode === 'register' ? 'login' : 'register');
  });

  els.handleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeGroup) return;
    const name = els.handleName.value.trim();
    if (!name) return;
    setGuestHandle(activeGroup.id, name.startsWith('@') ? name.slice(1) : name);
    els.handleDialog.close();
    await ensureRemoteMembership();
    renderAll();
    els.messageInput.focus();
  });
  // Guests may read without joining; only sending requires a handle.
  els.handleDialog.addEventListener('close', () => renderAll());

  els.groupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const user = currentUser();
      activeGroup = await createGroup(els.groupName.value, els.groupTopicInput.value, user.name);
      setUrlGroup(activeGroup.id);
      els.groupDialog.close();
      renderAll();
    } catch (err) {
      alert(err.message);
    }
  });

  els.avatarFile.addEventListener('change', async () => {
    const file = els.avatarFile.files[0];
    if (!file) return;
    pendingAvatar = await fileToAvatar(file);
    els.avatarPreview.src = pendingAvatar;
  });
  els.avatarReset.addEventListener('click', () => {
    const user = currentUser();
    pendingAvatar = null;
    els.avatarPreview.src = genericAvatar(user ? user.name : '?');
    els.avatarFile.value = '';
  });
  els.avatarForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!setUserAvatar(pendingAvatar)) {
      alert('Only logged-in users can change their profile picture.');
      return;
    }
    if (remoteMode) {
      try {
        await setRemoteAvatar(pendingAvatar);
      } catch {
        // Server unreachable mid-session: local picture stands.
      }
    }
    els.avatarDialog.close();
    await ensureRemoteMembership();
    renderAll();
  });

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('dialog').close());
  });

  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  const paintScheme = () => {
    els.appearanceNote.textContent =
      `Appearance: ${scheme.matches ? 'dark' : 'light'} (follows browser Dark Mode) · ` +
      (remoteMode ? 'live sync on' : 'local demo mode');
  };
  scheme.addEventListener('change', paintScheme);
  paintScheme();
}

/** Password + register mode exist only with a backend; offline stays name-only. */
function configureLoginDialog() {
  els.loginPasswordRow.hidden = !remoteMode;
  els.loginModeToggle.hidden = !remoteMode;
  els.loginPassword.required = remoteMode;
  setLoginMode('login');
}

function setLoginMode(mode) {
  loginMode = mode;
  const register = mode === 'register';
  els.loginDialog.querySelector('h2').textContent = register ? 'Create account' : 'Log in';
  els.loginSub.textContent = register
    ? 'Pick a display name and password to create groups and set a profile picture.'
    : 'Logged-in users can create groups and set a profile picture.';
  els.loginPassword.autocomplete = register ? 'new-password' : 'current-password';
  els.loginSubmit.textContent = register ? 'Create account' : 'Log in';
  els.loginModeToggle.textContent = register ? 'Log in instead' : 'Create an account instead';
}

function openLoginDialog() {
  setLoginMode('login');
  els.loginName.value = '';
  els.loginPassword.value = '';
  els.loginDialog.showModal();
}

function renderAll() {
  renderGroupChrome();
  renderAuthArea();
  renderModels();
  renderChat();
}

function renderGroupChrome() {
  const groups = listGroups();
  els.groupSelect.innerHTML = '';
  for (const g of groups) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.title;
    if (activeGroup && g.id === activeGroup.id) opt.selected = true;
    els.groupSelect.appendChild(opt);
  }
  els.groupSelect.disabled = groups.length === 0;

  if (activeGroup) {
    els.groupTitle.textContent = activeGroup.title;
    els.groupTopic.textContent = activeGroup.topic || '';
  } else if (groupIdFromUrl()) {
    els.groupTitle.textContent = 'Group not found';
    els.groupTopic.textContent = remoteMode
      ? 'This invite link matches no group on the server. Ask the sender for a fresh link.'
      : 'This invite link matches no group in this browser (demo data is stored locally). ' +
        'Ask the sender to re-invite you, or create a group.';
  } else {
    els.groupTitle.textContent = 'No groups yet';
    els.groupTopic.textContent = 'Log in and create the first group to get started.';
  }

  els.newGroupBtn.disabled = !canCreateGroups();
  els.newGroupBtn.title = canCreateGroups()
    ? 'Create a new group chat'
    : 'Log in to create groups — guests join via invite link';
  els.inviteBtn.disabled = !activeGroup;
}

function renderAuthArea() {
  const user = currentUser();
  els.authArea.innerHTML = '';
  if (!user) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary';
    btn.textContent = 'Log in';
    btn.addEventListener('click', () => openLoginDialog());
    els.authArea.appendChild(btn);
    return;
  }
  const chip = document.createElement('span');
  chip.className = 'user-chip';
  const img = document.createElement('img');
  img.className = 'avatar';
  img.alt = '';
  img.src = avatarFor(user);
  const label = document.createElement('span');
  label.innerHTML = `<span class="name"></span> <span class="kind">logged in</span>`;
  label.querySelector('.name').textContent = user.name;
  const picBtn = document.createElement('button');
  picBtn.type = 'button';
  picBtn.className = 'btn btn-ghost';
  picBtn.textContent = 'Picture';
  picBtn.title = 'Change profile picture';
  picBtn.disabled = !canChangeAvatar();
  picBtn.addEventListener('click', openAvatarDialog);
  const outBtn = document.createElement('button');
  outBtn.type = 'button';
  outBtn.className = 'btn btn-ghost';
  outBtn.textContent = 'Log out';
  outBtn.addEventListener('click', async () => {
    if (remoteMode) await logoutAccount();
    else logout();
    renderAll();
  });
  chip.append(img, label, picBtn, outBtn);
  els.authArea.appendChild(chip);
}

function renderModels() {
  els.modelList.innerHTML = '';
  for (const m of AI_MODELS) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'roster-item model-pick';
    btn.title = `Insert @${m.handle} into your message`;
    btn.innerHTML =
      `<span class="model-dot" aria-hidden="true"></span>` +
      `<span class="name"><span class="sub"></span></span>`;
    const name = btn.querySelector('.name');
    name.prepend(`@${m.handle} · ${m.name}`);
    btn.querySelector('.sub').textContent = m.desc;
    btn.addEventListener('click', () => {
      els.messageInput.value += els.messageInput.value.endsWith(' ') ||
        els.messageInput.value === '' ? `@${m.handle} ` : ` @${m.handle} `;
      els.messageInput.focus();
    });
    li.appendChild(btn);
    els.modelList.appendChild(li);
  }
}

function renderChat() {
  if (!activeGroup) {
    unwatchGroup();
    els.messages.innerHTML = '';
    els.participantList.innerHTML = '';
    els.participantCount.textContent = '';
    els.composerNote.textContent = '';
    setComposerEnabled(false);
    return;
  }
  const me = identityFor(activeGroup.id);
  renderMessages(els.messages, activeGroup, me);
  renderParticipants(els.participantList, els.participantCount, activeGroup, me);
  watchGroup(activeGroup.id, { onUpdate: () => renderChat() });
  if (!me) {
    setComposerEnabled(false, 'Join with a handle to participate — guests get a generic avatar.');
  } else if (me.kind === 'guest') {
    setComposerEnabled(true, `Posting as guest “${me.name}”. Log in to create groups or set a picture.`);
  } else {
    setComposerEnabled(true, `Posting as ${me.name} (logged in).`);
  }
}

function setComposerEnabled(on, note) {
  els.messageInput.disabled = !on;
  els.composer.querySelector('button[type="submit"]').disabled = !on;
  els.composerNote.textContent = on ? (note || '') : (note || '');
}

function openAvatarDialog() {
  const user = currentUser();
  if (!user || !canChangeAvatar()) {
    alert('Only logged-in users can change their profile picture.');
    return;
  }
  pendingAvatar = user.avatar;
  els.avatarPreview.src = avatarFor(user);
  els.avatarFile.value = '';
  els.avatarDialog.showModal();
}

/** Downscale an upload to a 128px square data URL for localStorage. */
function fileToAvatar(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const side = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = reject;
    img.src = url;
  });
}
