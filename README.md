# GPA — Group Planning Assistant

GPA is a group-planning assistant. It starts with a group chat interface:
create a group, share an invite link, plan together, and `@ask` an AI
right inside the conversation.

This repository currently contains the **front end only**, [demo on https://my-ai.us/gpa/](https://my-ai.us/gpa/).
Chat data is stored in the browser via `localStorage`, and AI replies are
local demo stubs behind a single module boundary (`js/models.js`) so a real
backend can replace them later without touching the UI.

## Quick start

No build step. Serve the directory over HTTP (ES modules require it) and
open the printed URL in a browser:

```sh
python3 -m http.server 8000
# open http://localhost:8000/ in a browser
```

Any static file server works. A first-run demo group ("Weekend Trip") is
seeded automatically so the layout, info bar, and `@planner` replies are
visible immediately.

## Access control

| Action                              | Logged-in user | Guest with invite link |
| ----------------------------------- | :------------: | :--------------------: |
| Create group chats                  |       yes      |           no           |
| Change profile picture              |       yes      |           no           |
| Join a group via invite link        |       yes      |          yes           |
| Pick a handle + generic thumbnail   |   n/a (login)  |          yes           |
| Send messages, `@ask` an AI         |       yes      |          yes           |

Guests choose a handle when they open an invite link and are assigned a
generic avatar. Enforcement lives in `js/auth.js` (`canCreateGroups()`,
`canChangeAvatar()`) and is applied both to the UI (disabled buttons with
explanations) and to the underlying actions.

## Layout

- **Info bar** lists group participants and available AI models. It docks on
  the **left in landscape** and moves to the **bottom in portrait**
  (`css/layout.css`, orientation media queries).
- **Dark Mode**: foreground/background colors follow the browser's
  `prefers-color-scheme` preference automatically (`css/theme.css`).
- Clicking an AI model in the info bar inserts `@handle` into the composer.

## Project structure

```text
index.html          HTML5 shell; loads /css and /js modules
css/                one concern per file
  base.css          reset, tokens, typography
  theme.css         light/dark via prefers-color-scheme
  layout.css        top bar + responsive info-bar placement
  sidebar.css       participants / AI model lists
  chat.css          messages, bubbles, composer
  components.css    buttons, dialogs, inputs, avatars
js/                 ES modules (loaded via <script type="module">)
  app.js            entry point: wiring, dialogs, init
  groups.js         create/resolve groups, invite links
  auth.js           login vs guest session, capability gates
  store.js          localStorage persistence + demo seed
  chat.js           message render + send flow
  participants.js   info-bar participant list
  models.js         AI roster, @mention parsing, demo replies
  avatar.js         generic thumbnails, uploaded pictures
assets/             static images (default avatar)
```

## Roadmap

- Real backend: accounts, group membership, message sync (WebSocket).
- Server-side enforcement of the access-control matrix.
- Real model calls behind `askModel()`; per-group model configuration.
- Read receipts, polls, shared itinerary/checklist views.

## License

GPA is free software under the **GNU General Public License v2**.
See [LICENSE](LICENSE) for the full text.

```text
SPDX-License-Identifier: GPL-2.0-only
```
