# Boss Tracker Maintenance Contract

Read this file completely before changing the project. This is a production boss timer used by multiple screens at the same time. A visually small change can corrupt timer state, duplicate Firebase usage, or desynchronize users.

## Stable recovery point

- Primary stable release: `stable-v1.3.25`
- Previous recovery releases: `stable-v1.3.24`, `stable-v1.3.23`, `stable-v1.3.22`, and `stable-v1.3.13` (keep unchanged for historical rollback)
- Stable commit is recorded by the annotated Git tag on GitHub.
- Production URL: `https://boss-time-eloni.vercel.app/`
- Firebase RTDB project: `boss-timel2m`
- If a later deployment breaks, restore or redeploy the stable tag. Never replace Firebase data with `server/data/store.json` while restoring code.

## Required boss-time behavior

1. A boss with no recorded kill/spawn time is `Unset` and does nothing.
2. Once a time is recorded, the timer continues until Admin uses Unset or a reset action.
3. At spawn time, the boss moves to the top and displays `NOW` for exactly five minutes.
4. If no new kill time is recorded during those five minutes, use the scheduled spawn as the latest kill time and calculate the next cycle automatically.
5. `Still alive` pins the boss at `NOW` indefinitely until Admin updates it.
6. Do not read or write Firebase every second. One-second countdown rendering must be local and use the server clock offset.
7. Every screen must derive time from the same server time and receive the same Firebase-backed state.
8. Never mutate only the rendered `NOW`, `Spawned`, or `Unset` text in the DOM. React state and `next_spawn` are the single display source.
9. React owns boss row grouping and ordering. Helper scripts may add alert classes but must never move, append, or reorder React-managed table rows.

## Realtime consistency contract

- Firebase is the production source of truth. The bundled `server/data/store.json` is only a local fallback/seed and must never overwrite an existing cloud dataset.
- Every Firebase mutation increments `tracker/meta/dataRevision` atomically in the same write.
- `/poll` returns `dataRevision`, `source`, `stale`, and `serverTime`.
- The browser must reject a poll snapshot older than the highest revision it has already accepted.
- A cold Vercel instance must load Firebase before serving the dashboard. It may retry only during cold start; do not add a database read to each countdown tick or normal poll.
- `recentLiveEvents` is bounded. Do not replace it with unbounded history or rely only on a single overwritable event.
- Use boss IDs for identity. Do not identify a boss only by visible name/location text.
- Firebase health must not rely only on one Vercel instance's `.info/connected` value. Count a recent successful RTDB operation as healthy, distinguish connecting/stale/quota/configuration states, and require three consecutive generic failures before showing Offline.
- Never expose raw Firebase error messages or credential details through the health endpoint or status UI.

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
- Admin double-clicking a boss name toggles the shared pre-spawn alert. When enabled, it flashes for at most five minutes; double-clicking again clears it immediately, and reloading must not replay the same alert sound.
- Any action that starts, restarts, advances, unsets, or resets a boss timer must clear `pre_spawned`, `pre_spawn_expires_at`, and `alerted_by` in the same boss update. This stops flashing immediately on every screen without adding timer-based Firebase traffic.
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
2. Run `npm test`; the Unset, five-minute NOW, Still Alive, and catch-up tests must pass.
3. Review the staged file list and exclude `server/data/store.json` and secrets.
4. Deploy through GitHub/Vercel and verify the production version, authentication boundary, Firebase readiness, browser console, and relevant user flow.
5. For risky timer/data changes, create and validate a preview first. Keep `stable-v1.3.25`, `stable-v1.3.24`, `stable-v1.3.23`, `stable-v1.3.22`, and `stable-v1.3.13` unchanged; use `stable-v1.3.25` as the primary recovery point.

## Parallel Google Sheets Mirror & Failover

- Parallel mirroring: Every boss/event/settings mutation is asynchronously mirrored to Google Sheets via `server/google-sheets.js` and `google_apps_script/Code.gs`.
- Zero Countdown Traffic: Never mirror countdown ticks or second-level loops to Google Sheets.
- Auto-Failover: If Firebase suffers quota exhaustion or service outage, `db.getActiveSource()` resolves to `'google-sheets'`, and the backend dynamically serves/fetches store snapshots from Google Sheets.
- Active Source Indicator: `/poll` returns dynamic `source`. Top-bar badge visually renders `☁️ Firebase Live`, `📊 Google Sheets`, or `💾 Local Mode`.
- PIN Security: Google Sheets configuration in settings requires PIN verification (`0386231334`).

## Temporary Guest Access & Dual Language

- Temporary Guest: Admin can issue time-limited guest access with auto-expiration (`expiresAt`), isolated to Member permissions only with a distinct purple `🎟️ GUEST` badge.
- Dual-Language System: English is default (`en`), toggleable to Thai (`th`) via header button. Boss names must NEVER be translated.
- Unified Tooltips: Style #1 amber balloon with arrow (`#custom-unified-tooltip`) unifies all interactive tooltips.

## Files that define the system

- `server/server.js`: authentication, roles, routes, dashboard data, cold-start handling.
- `server/db.js`: cache, boss/event logic, five-minute NOW auto-advance, active data source resolution.
- `server/firebase.js`: Firebase initialization and atomic revisioned writes.
- `server/google-sheets.js`: parallel database adapter, async queue, and failover fetcher.
- `google_apps_script/Code.gs`: Google Apps Script Web App implementation.
- `public/js/realtime-alerts.js`: client revision guard, clock offset, audio, tooltips, and dynamic language switcher.
- `docs/HANDOVER_DEVELOPER_GUIDE.md`: fast onboarding and architecture handover guide for future developers/agents.
- `test/boss-timer.test.js` & `test/parallel-sheets-and-guest.test.js`: regression and behavioral test suites.
- `server/data/store.json`: user-owned local data; never treat it as current production truth.

If the requested change conflicts with this document, stop and ask the owner before implementing it.
