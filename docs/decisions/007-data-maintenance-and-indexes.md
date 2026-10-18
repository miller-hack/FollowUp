# ADR-007: Indexes, retention and cleanup, complete export

**Status:** Accepted · **Date:** 2026-10-16 · **Feature:** code-review-hardening

## Context
Hot queries lack indexes (M8). Several tables grow forever (M7). Deletes leave attachment files and FTS rows behind (M6). The export misses user tables and includes encrypted secrets (M9).

## Decision
- **Migration 7:**
  - indexes `mail_messages(account_id, folder, uid)`, `comments(task_id)`, `checklists(task_id)`, `attachments(task_id)`, `email_task_links(task_id)`, `notifications(created_at)`, `activity_log(created_at)`;
  - column `mail_messages.is_auto` (ADR-008).
- **`maintenance.ts`** runs at startup and daily. It prunes:
  - read notifications older than 90 days (at most 1000 kept);
  - `notify_log` older than 120 days;
  - `automation_fired` older than 400 days;
  - failed jobs older than 30 days;
  - `ai_usage` older than 400 days;
  - `slack_imported` older than 30 days.

  It also removes orphan activity and FTS rows, and repairs invalid task dates (ADR-005).
- **Deletes:**
  - Deleting tasks (with subtasks), lists, folders or spaces removes their attachment folders after commit.
  - Deleting an account removes its `mail_fts` rows.
- **`buildExport()`** exports every user table. It excludes `secret:*` settings, account credentials, integration secrets and mail.

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| SQLite triggers for cleanup | Automatic | Can't delete files; FTS triggers add write cost | Files need application code anyway |
| No retention, rely on VACUUM | Nothing to tune | Doesn't bound growth | Doesn't solve M7 |

## Consequences
### Positive
- Bounded size, faster syncs and task panels, a complete and secret-free export.
### Negative
- Old read notifications and fire-once keys disappear. An overdue rule may fire again for a task overdue more than 400 days, which is acceptable.
### Risks
- A retention bug could delete live data. The queries are restricted by age and status and covered by tests.
