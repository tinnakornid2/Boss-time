# Future Google Sheets Failover Plan

Planning status only. None of this behavior is implemented in `stable-v1.3.23`.

## Goal

- Keep Firebase RTDB as the normal primary database.
- Mirror every successful shared-data mutation to Google Sheets without per-second traffic.
- Automatically fail over to Google Sheets when Firebase returns a confirmed quota error, or after repeated timeouts/connectivity failures.
- Continue serving all browsers through the existing server endpoints so database credentials never reach a browser.

## Owner role

- Add a third login role: `Owner`.
- Owner inherits Admin permissions and exclusively manages backup configuration, connection tests, manual synchronization, and failover controls.
- Store only a scrypt password hash in a Vercel environment variable. Never commit or document the real Owner password.
- Enforce Owner permissions on server routes; hiding UI is not authorization.
- Require recent Owner re-authentication for changing database credentials or forcing a data-source switch.

## Data and synchronization

- Use stable boss/event IDs, `operationId`, `dataRevision`, and `updatedAt` on both stores.
- Update only changed Sheet rows; never write countdown ticks.
- Mirror bosses, events, intentionally shared settings, bounded recent live events, metadata, and a bounded audit log.
- Never mirror passwords, sessions, service-account credentials, or device-local Display/Audio preferences.
- Queue failed Sheet mirrors for retry and expose `Synced`, `Pending`, and `Backup Error` states to Owner.

## Automatic failover

- Switch immediately on a confirmed Firebase quota-limit response.
- For timeouts or connection failures, use a circuit breaker and switch only after three consecutive failures.
- In fallback mode, write shared mutations to Sheets and serve cached Sheet snapshots through `/poll`.
- Refresh the server-side Sheet cache on a bounded interval; browser countdowns remain local.
- Display the active source clearly to all roles, while backup controls remain Owner-only.

## Recovery to Firebase

- Do not fail back after one successful probe.
- Require repeated Firebase health successes, replay queued operations in revision order, verify parity, and only then restore Firebase as primary.
- If revisions conflict or parity cannot be proven, remain on Sheets and require Owner review.

## Required implementation order

1. Introduce one storage adapter used by every mutation and require durable-write acknowledgement before returning `Saved`.
2. Define the Sheet schema and test it with non-production data.
3. Implement one-way Firebase-to-Sheets mirroring.
4. Add idempotent retry handling and bounded status/audit records.
5. Add read-only fallback and test multi-screen ordering, alerts, and clock behavior.
6. Add fallback writes, automatic circuit breaking, and safe recovery replay.
7. Validate in a Vercel preview with simulated quota, timeout, stale revision, duplicate operation, and recovery scenarios.
8. Obtain Owner approval before production deployment or changing the primary stable tag.
