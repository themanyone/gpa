// GPA — Group Planning Assistant (GPL-2.0-only). See LICENSE.
// avatar.js: generic thumbnails and user profile pictures.

const DEFAULT_AVATAR = 'assets/avatar-default.svg';

/** Stable hue (0-359) derived from a name. */
export function hueFor(name) {
  let hash = 0;
  const s = String(name || '?');
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) % 360;
  }
  return (hash + 360) % 360;
}

/** Initials (up to 2 chars) for a name or handle. */
export function initialsFor(name) {
  const parts = String(name || '?').replace(/^@/, '').split(/[\s._-]+/).filter(Boolean);
  const first = parts[0] ? parts[0][0] : '?';
  const second = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + second).toUpperCase();
}

/**
 * Generic thumbnail for a guest handle: SVG data URI with a stable
 * hue and initials. Works in both light and dark mode.
 */
export function genericAvatar(handle) {
  const hue = hueFor(handle);
  const initials = initialsFor(handle);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="32" fill="hsl(${hue},45%,42%)"/>` +
    `<text x="32" y="41" font-family="system-ui,sans-serif" font-size="24" ` +
    `font-weight="600" fill="#fff" text-anchor="middle">${initials}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

/** Resolve the picture for an identity {name, avatar}: upload wins, else generic. */
export function avatarFor(identity) {
  if (!identity) return DEFAULT_AVATAR;
  if (identity.avatar) return identity.avatar;
  return genericAvatar(identity.name);
}

export { DEFAULT_AVATAR };
