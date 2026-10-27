# GPA — Group Planning Assistant

GPA is a group-planning assistant. It starts with a group chat interface:
create a group, share an invite link, plan together, and `@ask` an AI
right inside the conversation.

Demo on [https://my-ai.us/gpa/](https://my-ai.us/gpa/).
The frontend works standalone against `localStorage`, and connects to the
Cloudflare Workers backend for shared groups and live sync when one is
available. AI replies are local demo stubs behind a single module boundary
(`public/js/models.js`) so real model calls can replace them later without
touching the UI.

## In Development/Testing

Run these from `backend/` (`npm install` once first). The `npm run`
scripts are thin wrappers around the same commands.

```sh
npx wrangler login    # log in to Cloudflare (opens browser, stores API token)
npx wrangler dev      # local dev server: API + frontend on :8787, live reload
npx wrangler deploy   # deploy the Worker to *.workers.dev (needs login first)
npx wrangler types    # regenerate worker-configuration.d.ts after config changes
npx wrangler logout   # log out / clear the stored API token
npx wrangler whoami   # show the currently logged-in Cloudflare account
npx wrangler tail     # stream live logs from the deployed Worker
npx wrangler --help   # list all wrangler commands
```

Manual check: open the dev URL in two browsers (or normal + private
window); a group created in one should appear live in the other, and an
invite link opened as guest should join and chat.

## Quick start

Full stack (frontend + API + live sync) via Wrangler:

```sh
cd backend && npm install && npm run dev
# open http://localhost:8787/ in a browser
```

Static frontend only (local demo mode, no shared groups):

```sh
cd public && python3 -m http.server 8000
# open http://localhost:8000/ in a browser
```

Any static file server works for the latter (ES modules require HTTP).
In local demo mode a first-run group ("Weekend Trip") is seeded automatically
so the layout, info bar, and `@planner` replies are visible immediately.

## Access control

| Action                              | Logged-in user | Guest with invite link |
| ----------------------------------- | :------------: | :--------------------: |
| Create group chats                  |       yes      |           no           |
| Change profile picture              |       yes      |           no           |
| Join a group via invite link        |       yes      |          yes           |
| Pick a handle + generic thumbnail   |   n/a (login)  |          yes           |
| Send messages, `@ask` an AI         |       yes      |          yes           |

Guests choose a handle when they open an invite link and are assigned a
generic avatar. Enforcement lives in `public/js/auth.js`
(`canCreateGroups()`, `canChangeAvatar()`) and is applied both to the UI
(disabled buttons with explanations) and to the underlying actions.
Note: the server currently accepts the client-claimed author name; real
accounts and server-side enforcement are the next slice (see Roadmap).

## Backend

`backend/` is a Cloudflare Worker (`wrangler.jsonc`, TypeScript):

- One `GroupRoom` Durable Object per group: members and messages in
  co-located SQLite storage, live fan-out over hibernatable WebSockets.
- The Worker serves `public/` as static assets and routes `/api/*`:
  `GET /api/health`, `POST /api/groups`, `GET /api/groups/:id`,
  `POST /api/groups/:id/join`, `GET|POST /api/groups/:id/messages`,
  `GET /api/groups/:id/ws` (WebSocket upgrade).
- The frontend probes same-origin `/api/health` on load; when it answers,
  groups sync live (the info bar shows "live sync on"), otherwise the app
  runs fully offline ("local demo mode"). Override the API base with
  `?api=<base-url>` (useful for pointing a local frontend at a deployed API).

```sh
cd backend
npm run dev        # local dev (API + frontend on :8787)
npm run typecheck  # tsc --noEmit
npm run types      # regenerate worker-configuration.d.ts after config changes
npm run deploy     # deploy to *.workers.dev (requires `wrangler login`)
```

## Layout

- **Info bar** lists group participants and available AI models. It docks on
  the **left in landscape** and moves to the **bottom in portrait**
  (`public/css/layout.css`, orientation media queries).
- **Dark Mode**: foreground/background colors follow the browser's
  `prefers-color-scheme` preference automatically (`public/css/theme.css`).
- Clicking an AI model in the info bar inserts `@handle` into the composer.

## Project structure

```text
public/              static frontend (also the Worker's assets directory)
  index.html         HTML5 shell; loads /css and /js modules
  css/               one concern per file
    base.css         reset, tokens, typography
    theme.css        light/dark via prefers-color-scheme
    layout.css       top bar + responsive info-bar placement
    sidebar.css      participants / AI model lists
    chat.css         messages, bubbles, composer
    components.css   buttons, dialogs, inputs, avatars
  js/                ES modules (loaded via <script type="module">)
    app.js           entry point: wiring, dialogs, init
    api.js           backend client, health probe, live channel
    groups.js        create/resolve groups, invite links, server sync
    auth.js          login vs guest session, capability gates
    store.js         localStorage cache + demo seed
    chat.js          message render + send flow + socket subscription
    participants.js  info-bar participant list
    models.js        AI roster, @mention parsing, demo replies
    avatar.js        generic thumbnails, uploaded pictures
  assets/            static images (default avatar)
backend/             Cloudflare Worker + Durable Objects (TypeScript)
  wrangler.jsonc     Worker config: assets, DO binding, observability
  src/index.ts       Worker entry: /api/* routing, CORS, validation
  src/group-room.ts  GroupRoom DO: SQLite members/messages, WS fan-out
```

## Roadmap

- ~~Backend: shared groups, guest membership, message sync (WebSocket).~~ Done.
- Real accounts; server-side enforcement of the access-control matrix.
- Real model calls behind `askModel()`; per-group model configuration.
- Read receipts, polls, shared itinerary/checklist views.

## License

GPA is free software under the **GNU General Public License v2**.
See [LICENSE](LICENSE) for the full text.

```text
SPDX-License-Identifier: GPL-2.0-only
```
