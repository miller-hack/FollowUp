# ADR-015: Follow-up in the Inbox replaces sequences

**Status:** Accepted · **Date:** 2026-10-26 · Supersedes the follow-up sequences of 0.6–1.0

## Context
1.0 had a separate Follow-ups page of automatic multi-step email sequences. The maintainer's team works differently:
- they need to see which conversations are waiting **for their reply**, and which of their own emails got **no answer**;
- they want a follow-up written for them from the conversation, which they approve before it goes out.

Replies from teammates (in copy, from their own mailboxes) must count, and weekends must not.

## Decision
- **Who is "us":** every connected mailbox, plus company domains (the mailboxes' own non-public domains, and any listed in Settings → Follow-up). Public mailboxes (gmail.com, outlook.com, …) never count as a company.
- **The rule** works on the latest real message of a conversation. Auto-replies, mailing lists, robots, drafts, and messages only in Spam or Trash are ignored.
  - **Reply needed:** the latest message is from outside, and nobody on our side answered within `replyAfterHours` working hours (default 24).
  - **Waiting on them:** the latest message is ours, it went to someone outside, and they haven't answered within `nudgeAfterHours` working hours (default 30).
  - Working hours count only on working days (default Monday–Friday). An email from Friday evening becomes due on Monday evening.
  - Conversations older than `lookbackDays` (default 14) are never brought up. A conversation marked Done, or one AI sorted as newsletter, notification or spam, doesn't need a reply.
- **State on the thread:** `followup_kind`, `followup_anchor` (the message the clock started from), `followup_since` and `followup_due_at`. It is recomputed after every sync and send, after changes to settings or accounts, and every 5 minutes. A conversation "is in Follow-up" when it is due, not snoozed, and not dismissed for its current anchor.
- **Snooze** hides it until a time. **No follow-up needed** hides it until a new message changes the anchor.
- **Drafting:** opening a due conversation from the Follow-up view writes a draft. It is AI-written from the last 10 messages, with the client's company, stage and recent logged contact as context; without AI it is a template.
  - The recipients are worked out for the user: the sender for "reply", the original outside recipients for "nudge".
  - Nothing is sent until the user clicks **Send follow-up**. The email goes through the normal outbox (ADR-004).
- **Also:** a daily reminder notification, an automation trigger "An email needs follow-up" (once per anchor, never for conversations already waiting when the rule was made), and an AI tool `list_follow_ups`.
- **Sequences removed:** running enrollments are stopped by migration 9, rules using "Start a follow-up sequence" are switched off, and the action can no longer be chosen. The tables stay for downgrade safety. Email templates remain.

## Alternatives considered
| Alternative | Pros | Cons | Why not |
|---|---|---|---|
| Keep sequences alongside | Hands-off chasing for some users | Two follow-up concepts; automatic sends the team didn't want | The maintainer chose to remove them |
| Compute on every list query | No stored state | Working-day maths per thread per query; can't index | Stored state + index is fast and testable |
| Count only connected mailboxes as "us" | Simple | A teammate's reply in copy would still show "reply needed" | Company domains match how teams work |

## Consequences
- The Inbox gains a Follow-up view with "Reply needed" and "Waiting on them" tabs, sorted by AI priority, then by how long it has waited.
- Users of 1.0 sequences lose automatic chasing; their running sequences stop at upgrade, as the release notes say.
- Tests: `tests/followup.test.ts` (rules, working days, teammates, dismiss/snooze, drafts, trigger); the E2E test sends a follow-up from the view.
