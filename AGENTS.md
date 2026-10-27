# AGENTS.md

This document provides essential context for AI agents working on the GPA (Group Planning Assistant) codebase.

## Project Overview
GPA is a group-planning assistant with a group chat interface, participant lists, and AI integration (currently using demo stubs). It has a vanilla JavaScript frontend and a Cloudflare Workers backend.

- **Tech Stack**: HTML5, CSS3, Vanilla JavaScript (ES Modules) frontend in `public/`; TypeScript Cloudflare Worker + Durable Objects backend in `backend/`.
- **Persistence**: Shared groups live in per-group Durable Object SQLite storage when a backend is available; otherwise the frontend runs fully offline against `localStorage` (which also acts as a read cache in remote mode).
- **Deployment**: `wrangler deploy` from `backend/` ships the Worker with `public/` as static assets. The frontend alone needs no build step and can be served by any HTTP server (ES modules forbid `file://`).

## Architecture & Data Flow

### Backend (`backend/`, TypeScript, `wrangler.jsonc`)
- `src/index.ts`: Worker entry. Routes `/api/*` to `GroupRoom` stubs (`getByName`), handles CORS/OPTIONS, validates input, returns JSON errors. Static files never reach it (assets are served first).
- `src/group-room.ts`: `GroupRoom` Durable Object — one instance per group. SQLite tables for meta/members/messages; RPC methods `ensureGroup`, `join`, `post`, `listMessages`, `getState`; `fetch` only upgrades WebSockets; `broadcast` fans new messages out to hibernated sockets.
- Non-goal (current slice): authentication. The server accepts the client-claimed author name; `kind` is validated to `user`/`guest`/`ai`.

### Core Modules (`public/js/`)
- `app.js`: The application entry point. Async boot (backend probe → resolve group → render), wires up DOM elements, dialogs, and the main lifecycle.
- `api.js`: The backend client. Same-origin `/api` base (override via `?api=` or `gpa.apiBase`), cached `isBackendAvailable()` probe, REST helpers, `connectGroupSocket` with backoff reconnect.
- `store.js`: The local cache layer. `localStorage` read/write for groups, messages, and sessions; `addMessage` upserts by id so server echoes don't duplicate; `saveMessages` replaces after sync.
- `auth.js`: Manages user identity (logged-in vs. guest) and provides capability gates (e.g., `canCreateGroups()`).
- `chat.js`: Handles the chat UI, message rendering, and the message sending flow. Remote mode posts through the server (server assigns ids); `watchGroup`/`unwatchGroup` manage the live subscription.
- `models.js`: Defines available AI models and handles `@mention` parsing for AI triggers. Currently contains demo stubs for AI replies, posted through the same channel so all clients see them.
- `groups.js`: Manages group creation (async; remote-first), invite links, `syncGroupFromServer`, and group resolution from URLs.
- `participants.js`: Manages the rendering of the participant list in the info bar.
- `avatar.js`: Handles avatar generation and management.

### Data Models
- **Group**: `{id, title, topic, members:[{name, kind, avatar}], createdBy, createdAt}`
- **Message**: `{id, author, kind:'user'|'guest'|'ai', avatar, text, ts}`
- **Session**: `{user: {name, avatar} | null, guests: {groupId: handle}}`
- Server mirrors these as `GroupInfo` / `ChatMessage` / `Member` in `backend/src/group-room.ts`.

## Development Workflow

### Running the App
Full stack (API + live sync + frontend on :8787):
```bash
cd backend && npm install && npm run dev
```
Frontend only (local demo mode):
```bash
cd public && python3 -m http.server 8000
```
Then navigate to the printed URL in a browser.

### Backend Scripts (`backend/package.json`)
- `npm run dev` — local dev server.
- `npm run deploy` — deploy to `*.workers.dev` (requires `wrangler login`).
- `npm run types` — regenerate `worker-configuration.d.ts` (gitignored) after config changes. Never hand-write `Env`.
- `npm run typecheck` — `tsc --noEmit`.

### Testing & Linting
- **Testing**: No committed test suite is currently implemented. Backend changes have been verified during development with throwaway harnesses (esbuild bundle + Node sqlite/WS shims, Playwright two-client sync); re-run equivalents before reporting done.
- **Linting**: No linting (ESLint, Prettier, etc.) is currently configured.

## Patterns & Conventions

### Code Style
- **ES Modules**: All frontend JavaScript is organized into modules loaded via `<script type="module">`. Backend is TypeScript bundled by Wrangler/esbuild.
- **Capability-based Access Control**: UI elements and actions are gated using functions from `public/js/auth.js` (e.g., `canCreateGroups()`).
- **Backend conventions**: one Durable Object per group addressed with `getByName()`; RPC methods over `fetch` (except the WS upgrade); SQLite via `ctx.storage.sql`; structured JSON logs; `crypto.getRandomValues()`/`crypto.randomUUID()` for ids.
- **CSS Organization**: Styles are split by concern:
    - `base.css`: Resets, tokens, typography.
    - `theme.css`: Light/dark mode via `prefers-color-scheme`.
    - `layout.css`: Main layout and responsive positioning.
    - `sidebar.css`, `chat.css`, `components.css`: Component-specific styles.

### UI/UX Patterns
- **Responsive Layout**: The info bar docks on the left in landscape mode and moves to the bottom in portrait mode (`public/css/layout.css`).
- **Dark Mode**: Automatically follows the browser's `prefers-color-scheme`.
- **AI Interaction**: Users can trigger AI responses by typing `@handle` (e.g., `@planner`) in the chat composer.
- **Sync Mode**: The info bar footer shows "live sync on" (backend) or "local demo mode" (offline).

## Important Gotchas
- **CORS/ES Modules**: Attempting to run the app by double-clicking `index.html` will result in CORS errors. Always use an HTTP server.
- **Demo Stubs**: AI functionality is currently simulated in `public/js/models.js`.
- **Demo Seed**: The "Weekend Trip" seed group is only created in local demo mode; with a backend, groups come from the server.
- **Guest Identity**: Guests are assigned a handle when they join a group via an invite link; membership is registered on the server via `join` (idempotent upsert).
- **Message Ids**: In remote mode the server assigns message ids; clients must render the POST response, not a locally-built message, or echoes will duplicate.
- **No Auth Yet**: The server trusts the client-claimed author name. Don't build anything that assumes verified identity until the auth slice lands.
