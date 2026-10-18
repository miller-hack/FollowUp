# Data model

Everything lives in one SQLite database, `%APPDATA%\FollowUp\followup.db`, opened with Electron's built-in `node:sqlite`. The schema is created and upgraded by numbered migrations in `src/main/db/migrations.ts`; `PRAGMA user_version` records how many have run.

**Settings on open:**
- `journal_mode = WAL`: readers don't block writers; the `-wal` and `-shm` files belong to the database;
- `foreign_keys = ON`: deletes cascade, for example list → tasks → checklists;
- `busy_timeout = 5000`;
- since 1.0, `auto_vacuum = INCREMENTAL`.

**Most tables** start with the common columns:

| Column | Type | Meaning |
|---|---|---|
| `id` | TEXT PK | UUID |
| `created_at` | TEXT | UTC ISO timestamp, set by default |
| `updated_at` | TEXT | UTC ISO timestamp (updated by services) |
| `deleted_at` | TEXT | Reserved for a future trash or sync; currently unused (deletes are real) |

**Date columns** called `start_date`, `due_date`, `remind_at`, `start` and `end` hold **local** app dates, `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`. Other timestamps are UTC ISO.

## Workspace

| Table | Columns | Notes |
|---|---|---|
| `spaces` | `name`, `color`, `position` | |
| `folders` | `space_id` → spaces, `name`, `position` | |
| `lists` | `space_id` → spaces, `folder_id` → folders (nullable), `name`, `color`, `position` | |
| `statuses` | `space_id` → spaces, `name`, `color`, `type` (`open`/`active`/`done`), `position` | Per space |
| `tags` | `name`, `color` | Global |
| `custom_fields` | `space_id`, `name`, `type`, `options` (JSON array of `{id,label,color}`), `position` | 12 types (see `FieldType`) |
| `settings` | `key` PK, `value` (JSON) | See [Settings keys](#settings-keys) |

## Tasks

| Table | Columns | Notes |
|---|---|---|
| `tasks` | `list_id`, `parent_id` (subtasks), `title`, `description` (HTML), `status_id`, `priority` (`urgent/high/normal/low/none`), `start_date`, `due_date`, `time_estimate_min`, `position`, `completed_at`, `recurrence` (JSON `{freq, interval}`), `source` (`manual/email/ai/automation/slack`), `source_ref`, `sprint_id` | Indexed by list, parent, due date, sprint |
| `task_tags` | `task_id`, `tag_id` (PK both) | |
| `custom_field_values` | `task_id`, `field_id` (PK both), `value` (JSON) | |
| `checklists` | `task_id`, `name`, `position` | |
| `checklist_items` | `checklist_id`, `text`, `done`, `position` | |
| `comments` | `task_id`, `body`, `author` (`me/ai/automation`) | |
| `attachments` | `task_id`, `file_name`, `mime`, `size`, `stored_path` | Files in `attachments\<task id>\` |
| `task_dependencies` | `task_id` (waiting), `blocked_by_id` (blocker) | Cycles refused in code |
| `activity_log` | `entity_type` (`task`), `entity_id`, `action`, `detail` | The task's history |
| `tasks_fts` | FTS5: `task_id`, `title`, `body` | Search index (HTML stripped) |

## Planning

| Table | Columns |
|---|---|
| `sprints` | `space_id`, `name`, `start_date`, `end_date`, `status` (`planned/active/closed`), `goal` |
| `time_entries` | `task_id`, `started_at`, `ended_at` (NULL = running), `duration_sec`, `note`, `billable` |
| `goals` | `name`, `description`, `color`, `due_date`, `position` |
| `key_results` | `goal_id`, `name`, `type` (`number/percent/currency/boolean/tasks`), `start_value`, `target_value`, `current_value`, `unit`, `position` |
| `key_result_tasks` | `key_result_id`, `task_id` |
| `dashboards` | `name`, `position` |
| `dashboard_widgets` | `dashboard_id`, `type`, `title`, `config` (JSON `WidgetConfig`), `size` (1–4), `position` |
| `reminders` | `task_id` (nullable), `title`, `remind_at`, `done_at`, `notified_at` |
| `notifications` | `kind` (`due/reminder/digest/info/automation`), `title`, `body`, `task_id`, `read_at` |
| `notify_log` | `key` PK, `created_at`: notices already sent (`due:<task>:<date>`, `digest:<date>`) |

## Automations and jobs

| Table | Columns |
|---|---|
| `automations` | `name`, `enabled`, `scope` (JSON `Location` or NULL), `trigger` (JSON `Trigger`), `conditions` (JSON `Condition[]`), `actions` (JSON `Action[]`), `run_count`, `last_run_at`, `position` |
| `automation_runs` | `automation_id`, `status` (`success/skipped/failed`), `task_id`, `trigger` (label), `detail` (JSON string array), `error`. The newest 100 per rule are kept. |
| `automation_fired` | `key` PK, `created_at`: fire-once keys for time-based triggers and send limits |
| `jobs` | `type`, `payload` (JSON), `run_at`, `attempts`, `max_attempts`, `status` (`pending/running/done/failed`), `last_error` |

The JSON shapes for `trigger`, `conditions` and `actions` are the TypeScript types in `src/shared/automation.ts`. For example:

```json
{
  "trigger": { "type": "status_changed", "from": null, "to": "Review" },
  "conditions": [{ "field": "priority", "op": "is", "value": "high" }],
  "actions": [
    { "type": "add_checklist", "name": "Review", "items": ["Proofread", "Get sign-off"] },
    { "type": "notify", "title": "Review: {{task.title}}" }
  ]
}
```

## Email

| Table | Columns | Notes |
|---|---|---|
| `accounts` | `kind` (`mail/caldav`), `name`, `email`, `config` (JSON `MailAccountConfig` or `CalDavConfig`), `secret` (encrypted app password **or** OAuth refresh token), `enabled`, `sync_state` (JSON per folder: `uidValidity`, `lastUid`), `last_sync_at`, `last_error` | |
| `mail_threads` | `account_id`, `subject`, `norm_subject`, `done`, `last_message_at`, `ai_category`, `ai_priority`, `ai_summary`, `ai_triaged_at` | |
| `mail_messages` | `account_id`, `thread_id`, `folder`, `uid`, `message_id`, `in_reply_to`, `refs` (JSON), `from_name`, `from_addr`, `to_addrs`/`cc_addrs` (JSON), `subject`, `date`, `snippet`, `body_text`, `body_html` (sanitised; inline images as `cid:`), `is_read`, `is_outbound`, `is_inbox`, `has_attachments`, `is_auto` | UNIQUE (`account_id`, `message_id`) |
| `mail_attachments` | `message_id`, `filename`, `mime`, `size`, `stored_path`, `inline` (1 = picture shown in the body), `content_id` | Files under `mail\<account>\` |
| `mail_fts` | FTS5: `message_id`, `subject`, `sender`, `body` | |
| `email_task_links` | `thread_id`, `task_id` | |
| `outbox` | `account_id`, `to_addrs`, `cc_addrs`, `subject`, `body`, `in_reply_to`, `refs`, `thread_id`, `status` (`queued/sent/failed`), `error`, `sent_at`, `source` (`manual/sequence/automation`), `enrollment_id`, `message_id` | |
| `email_templates` | `name`, `subject`, `body` | |
| `sequences` | `name`, `send_window` (JSON `{days, start, end}`), `daily_cap` | |
| `sequence_steps` | `sequence_id`, `position`, `wait_days`, `body` | |
| `sequence_enrollments` | `sequence_id`, `thread_id`, `account_id`, `to_addrs`, `status` (`active/replied/completed/stopped/bounced/failed`), `current_step`, `next_run_at` (NULL while a step is in flight), `enrolled_at`, `last_sent_at`, `last_queued_at`, `stopped_reason` | |

## Calendar

| Table | Columns |
|---|---|
| `calendars` | `account_id` (NULL = the local calendar), `url`, `name`, `color`, `ctag`, `enabled`, `read_only` |
| `calendar_events` | `calendar_id`, `uid`, `href`, `etag`, `title`, `description`, `location`, `start`, `end`, `all_day`, `rrule`, `exdates`, `raw` (iCalendar text), `task_id`, `dirty` (needs upload), `pending_delete` |

## AI

| Table | Columns |
|---|---|
| `ai_conversations` | `title`, `provider`, `model`, `system` (frozen system prompt), `status` (`idle/running/awaiting_approval/error`), `error` |
| `ai_messages` | `conversation_id`, `seq`, `role` (`user/assistant/tool`), `native` (the provider's own message JSON; append-only), `view` (what the chat shows, JSON `ChatMessageView`) |
| `ai_usage` | `feature`, `provider`, `model`, `input_tokens`, `output_tokens`, `cache_read_tokens` |

## Integrations

| Table | Columns |
|---|---|
| `integrations` | `kind` (`slack_webhook/slack_bot/teams_webhook`), `name`, `secret` (encrypted URL or token), `config` (JSON: channel, `mirrorNotifications`, `watch`), `enabled`, `last_error`, `last_used_at` |
| `slack_imported` | `integration_id`, `ts` (PK both), `task_id`, `created_at` |

## Settings keys

| Key | Value |
|---|---|
| `app` | The `Settings` object (`src/shared/types.ts`). Defaults are in `DEFAULT_SETTINGS` (`services/meta.ts`). Stored values are merged over the defaults, so new settings need no migration. |
| `view:<kind>:<id>` and `everything` | Saved `ViewConfig` per location |
| `secret:anthropic`, `secret:openai`, `secret:oauth_google`, `secret:oauth_microsoft` | Encrypted secrets (never exported, never sent to the window) |
| `maintenance:*` | One-time conversion markers, e.g. `maintenance:inline-images-v1` |

## Migrations

| # | Adds |
|---|---|
| 1 | Workspace, tasks, tags, custom fields, checklists, comments, attachments, dependencies, activity, `tasks_fts` |
| 2 | Sprints, time entries, goals, key results, dashboards, reminders, notifications, `notify_log` |
| 3 | Automations, runs, fire-once keys, jobs |
| 4 | Accounts, mail, outbox, templates, sequences, calendars, events |
| 5 | AI conversations, messages, usage; AI triage columns on threads |
| 6 | Integrations, `slack_imported` |
| 7 | Hot-path indexes; `mail_messages.is_auto` |
| 8 | `mail_attachments.inline`, `content_id` + index |

**Rules for new migrations:**
1. **Append** a new SQL string to `MIGRATIONS`. Never edit or reorder existing ones, because users' databases have already run them.
2. Keep it additive where possible (`ALTER TABLE … ADD COLUMN … DEFAULT …`, `CREATE INDEX IF NOT EXISTS`), so an older app version can still open a newer database.
3. Each migration runs in a transaction together with the `user_version` bump.
4. For data conversions that may take long, prefer a time-boxed step in `maintenance.ts`, guarded by a `maintenance:*` flag (see ADR-010), over a slow migration that delays start-up.
