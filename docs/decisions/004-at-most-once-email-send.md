# ADR-004: At-most-once email sending

**Status:** Accepted · **Date:** 2026-10-16 · **Feature:** code-review-hardening

## Context
An outbox row becomes `sent` only after SMTP, the Sent-folder append and the local store. A failure or crash after SMTP accepts makes the job retry and send again (H4). Compose has no in-flight guard.

## Decision
Mark the row `sent` (and the enrollment's `last_sent_at`) immediately after SMTP accepts, in its own statement. The Sent append and local copy are best effort: logged, never rethrown. Retries return early on `sent`. Compose uses a ref-based in-flight guard.

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Keep at-least-once, dedupe by Message-ID | Never loses a Sent copy | SMTP servers don't dedupe; recipients get duplicates | Duplicates are worse than a missing local copy |
| Two-phase state (`sending` → `sent`) | Detects crashes during SMTP | Still ambiguous after a crash mid-SMTP | Adds a state without removing the ambiguity |

## Consequences
### Positive
- A failure after the server accepts never causes a second send.
### Negative
- If the local copy fails, the sent mail may be missing from the thread until the next Sent-folder sync.
### Risks
- A crash during the SMTP call itself is still ambiguous; that's an inherent limit of SMTP.
