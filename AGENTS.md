# Boss Tracker Maintenance Contract

Read this file completely before changing the project. This is a production boss timer used by multiple screens at the same time. A visually small change can corrupt timer state, duplicate Firebase usage, or desynchronize users.

## Stable recovery point

- Stable release: `stable-v1.3.13`
- Stable commit is recorded by the annotated Git tag on GitHub.
- Production URL: `https://boss-time-eloni.vercel.app/`
- Firebase RTDB project: `boss-timel2m`
- If a later deployment breaks, restore or redeploy the stable tag. Never replace Firebase data with `server/data/store.json` while restoring code.

## Required boss-time behavior

1. A boss with no recorded kill/spawn time is `Unset` and does nothing.
2. Once a time is recorded, the timer continues until Admin uses Unset or a reset action.
3. At spawn time, the boss moves to the top and displays `NOW` for exactly ten minutes.
4. If no new kill time is recorded during those ten minutes, use the scheduled spawn as the latest kill time and calculate the next cycle automatically.
5. `Still alive` pins the boss at `NOW` indefinitely until Admin updates it.
6. Do not read or write Firebase every second. One-second countdown rendering must be local and use the server clock offset.
7. Every screen must derive time from the same server time and receive the same Firebase-backed state.
8. Never mutate only the rendered `NOW`, `Spawned`, or `Unset` text in the DOM. React state and `next_spawn` are the single display source.

## Realtime consistency contract

- Firebase is the production source of truth. The bundled `server/data/store.json` is only a local fallback/seed and must never overwrite an existing cloud dataset.
- Every Firebase mutation increments `tracker/meta/dataRevision` atomically in the same write.
- `/poll` returns `dataRevision`, `source`, `stale`, and `serverTime`.
- The browser must reject a poll snapshot older than the highest revision it has already accepted.
- A cold Vercel instance must load Firebase before serving the dashboard. It may retry only during cold start; do not add a database read to each countdown tick or normal poll.
- `recentLiveEvents` is bounded. Do not replace it with unbounded history or rely only on a single overwritable event.
- Use boss IDs for identity. Do not identify a boss only by visible name/location text.

## Roles and settings

- Admin: may update/unset/reset boss times, maintain bosses/events, and send double-click member alerts.
- Member: view-only for shared boss/event data and shared alerts. Member must not mutate boss/event data and must not send double-click alerts.
- Member may freely increase/decrease volume, mute/unmute, choose alert sounds, and change all Display/Audio preferences on their own device.
- Enforce permissions on server routes with `requireAdmin`; hiding a button is not security.
- Display and Audio settings are local per browser/device and must remain available to both Admin and Member. Do not sync these preferences into shared Firebase settings.
- Shared settings are limited to data that is intentionally global, such as announcements and server-wide labels.

## Audio and alert behavior

- Browsers require a user interaction before audio can play. Preserve the audio-unlock control and first-interaction handling.
- Alert before spawn, spawn sound, double-click alert, flash, and message must be driven from the same boss/event update.
- Keep sound queuing and event deduplication so rapid updates do not lose or duplicate sounds.
- A Member can receive alerts but cannot initiate shared alerts.

## Firebase quota and data safety

- Countdown updates are local only; no per-second Firebase access.
- Prefer narrow multipath updates for changed boss array positions.
- The current delete operation rewrites the full bosses array because deletion shifts array indexes. Migrating to ID-keyed objects requires a planned, reversible data migration.
- Do not edit, commit, reset, seed, or restore `server/data/store.json` unless the owner explicitly asks to change production data.
- Do not commit Firebase service-account credentials, passwords, session secrets, exported user data, or backups containing secrets.
- Firebase rules must remain version-controlled once added. Member access must be read-only and Admin writes must be validated.

## Authentication contract

- All dashboard and data endpoints require login.
- Sessions are signed, HttpOnly, Secure in production, SameSite=Lax, and persist for 30 days.
- Session signing material must be stable across Vercel instances. Never include app version, random startup values, or instance-specific values in the signing key.
- Passwords use scrypt hashes. Never document or log real passwords.
- The login password field must submit with Enter as well as the button.

## Change procedure

Before editing:

1. Check `git status`; preserve unrelated and user-owned changes, especially `server/data/store.json`.
2. Read the affected route, `server/db.js`, `server/firebase.js`, and `public/js/realtime-alerts.js` when changing timer/realtime behavior.
3. Confirm the change does not violate the contracts above or increase Firebase reads/writes on a timer.

Before production deployment:

1. Run syntax checks for changed JavaScript files.
2. Run `npm test`; the Unset, ten-minute NOW, Still Alive, and catch-up tests must pass.
3. Review the staged file list and exclude `server/data/store.json` and secrets.
4. Deploy through GitHub/Vercel and verify the production version, authentication boundary, Firebase readiness, browser console, and relevant user flow.
5. For risky timer/data changes, create and validate a preview first. Keep `stable-v1.3.13` unchanged as the primary recovery point.

## Files that define the system

- `server/server.js`: authentication, roles, routes, dashboard data, cold-start handling.
- `server/db.js`: cache, boss/event logic, ten-minute NOW auto-advance, Firebase readiness.
- `server/firebase.js`: Firebase initialization and atomic revisioned writes.
- `public/js/realtime-alerts.js`: client revision guard, clock offset, audio, realtime events, tooltips.
- `test/boss-timer.test.js`: required timer behavior tests.
- `server/data/store.json`: user-owned local data; never treat it as current production truth.

If the requested change conflicts with this document, stop and ask the owner before implementing it.
