# ADR-003: Isolate per-item failures in sync and queue loops

**Status:** Accepted · **Date:** 2026-10-16 · **Feature:** code-review-hardening

## Context
Mail sync aborts the whole folder on one bad message, and its state isn't saved, so it retries forever (H3). CalDAV sync aborts the whole account on one rejected event (M1). A failed follow-up step leaves the enrollment "active" with no next run (M3).

## Decision
- Mail sync: each message is parsed and stored in its own try/catch. Failures are counted, the UID still advances, and `last_error` says "Skipped N message(s) that could not be read".
- CalDAV: each event is pushed in its own try/catch. A failed event stays dirty and is retried on the next sync. Pulling continues, and `last_error` summarises the failures.
- Follow-up step jobs get a failure handler that marks the enrollment `failed` with the reason.

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Quarantine table for bad items | Inspectable | Schema and UI work | The skip count plus logs are enough for a single-user app |
| Retry the whole sync with backoff | No code per loop | One bad item still blocks every other item | Doesn't solve it |

## Consequences
### Positive
- One broken item can't stop the rest.
### Negative
- A skipped message never appears in the app (it's still on the server).
### Risks
- Real errors could be hidden by skipping, so the count is surfaced on the account card.
