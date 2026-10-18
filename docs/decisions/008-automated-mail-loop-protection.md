# ADR-008: Don't auto-reply to automated mail; rate-limit automated sends

**Status:** Accepted · **Date:** 2026-10-16 · **Feature:** code-review-hardening

## Context
Email-triggered automations can reply to auto-responders and mailing lists, so two auto-responders can loop without limit (M5, RFC 3834).

## Decision
- `parseRaw` flags `auto` from:
  - `Auto-Submitted` (anything but `no`)
  - `Precedence` (bulk / junk / list / auto_reply)
  - `X-Autoreply` or `X-Autorespond`
  - `List-Id`
  - `X-Auto-Response-Suppress`
  - a mailer-daemon or postmaster sender

  The flag is stored as `mail_messages.is_auto`.
- The automation actions `reply_to_email`, and `send_email` in an email context, skip automated messages. They also send at most once per rule, recipient and day. Each skip is recorded in the run history.
- Other actions (create task, mark read, start sequence) still run on automated mail, since rules like "notification → task" are legitimate.

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Ignore automated mail for all email triggers | Simple | Breaks legitimate rules on notifications | Too broad |
| Only a rate limit | Bounds loops | Still replies to auto-responders once a day | Fails RFC 3834's "don't reply to auto-replies" |

## Consequences
### Positive
- No reply loops; polite behaviour toward mailing lists.
### Negative
- A rule that intentionally replies to list mail won't (rare).
### Risks
- A legitimate personal email with `List-Id` would be treated as automated for replies only. That's acceptable.
