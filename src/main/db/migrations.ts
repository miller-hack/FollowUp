import type { DatabaseSync } from 'node:sqlite'

const base = `id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT`

/** Each entry is applied once, in order; PRAGMA user_version tracks progress. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE spaces (${base},
    name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#7b68ee', position REAL NOT NULL DEFAULT 0);

  CREATE TABLE folders (${base},
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL, position REAL NOT NULL DEFAULT 0);

  CREATE TABLE lists (${base},
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL, color TEXT, position REAL NOT NULL DEFAULT 0);

  CREATE TABLE statuses (${base},
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL, color TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'open',
    position REAL NOT NULL DEFAULT 0);

  CREATE TABLE tasks (${base},
    list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status_id TEXT NOT NULL REFERENCES statuses(id),
    priority TEXT NOT NULL DEFAULT 'none',
    start_date TEXT, due_date TEXT, time_estimate_min INTEGER,
    position REAL NOT NULL DEFAULT 0,
    completed_at TEXT, recurrence TEXT,
    source TEXT NOT NULL DEFAULT 'manual', source_ref TEXT);
  CREATE INDEX idx_tasks_list ON tasks(list_id);
  CREATE INDEX idx_tasks_parent ON tasks(parent_id);
  CREATE INDEX idx_tasks_due ON tasks(due_date);

  CREATE TABLE tags (${base}, name TEXT NOT NULL, color TEXT NOT NULL);
  CREATE TABLE task_tags (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, tag_id));

  CREATE TABLE custom_fields (${base},
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL, type TEXT NOT NULL, options TEXT NOT NULL DEFAULT '[]',
    position REAL NOT NULL DEFAULT 0);
  CREATE TABLE custom_field_values (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    field_id TEXT NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
    value TEXT NOT NULL,
    PRIMARY KEY (task_id, field_id));

  CREATE TABLE checklists (${base},
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    name TEXT NOT NULL, position REAL NOT NULL DEFAULT 0);
  CREATE TABLE checklist_items (${base},
    checklist_id TEXT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
    text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, position REAL NOT NULL DEFAULT 0);

  CREATE TABLE comments (${base},
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    body TEXT NOT NULL, author TEXT NOT NULL DEFAULT 'me');

  CREATE TABLE attachments (${base},
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, stored_path TEXT NOT NULL);

  CREATE TABLE task_dependencies (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    blocked_by_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, blocked_by_id));

  CREATE TABLE activity_log (${base},
    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
  CREATE INDEX idx_activity_entity ON activity_log(entity_type, entity_id);

  CREATE VIRTUAL TABLE tasks_fts USING fts5(task_id UNINDEXED, title, body, tokenize = 'unicode61 remove_diacritics 2');
  `,
  // ---- Phase 2: time tracking, goals, sprints, dashboards, reminders, notifications
  `
  CREATE TABLE sprints (${base},
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned', goal TEXT NOT NULL DEFAULT '');
  ALTER TABLE tasks ADD COLUMN sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL;
  CREATE INDEX idx_tasks_sprint ON tasks(sprint_id);

  CREATE TABLE time_entries (${base},
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL, ended_at TEXT, duration_sec INTEGER,
    note TEXT NOT NULL DEFAULT '', billable INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX idx_time_task ON time_entries(task_id);
  CREATE INDEX idx_time_start ON time_entries(started_at);

  CREATE TABLE goals (${base},
    name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', color TEXT NOT NULL,
    due_date TEXT, position REAL NOT NULL DEFAULT 0);
  CREATE TABLE key_results (${base},
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    name TEXT NOT NULL, type TEXT NOT NULL,
    start_value REAL NOT NULL DEFAULT 0, target_value REAL NOT NULL DEFAULT 1, current_value REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT '', position REAL NOT NULL DEFAULT 0);
  CREATE TABLE key_result_tasks (
    key_result_id TEXT NOT NULL REFERENCES key_results(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (key_result_id, task_id));

  CREATE TABLE dashboards (${base}, name TEXT NOT NULL, position REAL NOT NULL DEFAULT 0);
  CREATE TABLE dashboard_widgets (${base},
    dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    type TEXT NOT NULL, title TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}',
    size INTEGER NOT NULL DEFAULT 1, position REAL NOT NULL DEFAULT 0);

  CREATE TABLE reminders (${base},
    task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL, remind_at TEXT NOT NULL, done_at TEXT, notified_at TEXT);
  CREATE INDEX idx_reminders_at ON reminders(remind_at);

  CREATE TABLE notifications (${base},
    kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, read_at TEXT);

  -- keys of notifications already sent, so each fires once
  CREATE TABLE notify_log (key TEXT PRIMARY KEY, created_at TEXT NOT NULL);
  `,
  // ---- Phase 3: automations + persistent job queue
  `
  CREATE TABLE automations (${base},
    name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    scope TEXT, trigger TEXT NOT NULL, conditions TEXT NOT NULL DEFAULT '[]', actions TEXT NOT NULL DEFAULT '[]',
    run_count INTEGER NOT NULL DEFAULT 0, last_run_at TEXT, position REAL NOT NULL DEFAULT 0);

  CREATE TABLE automation_runs (${base},
    automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    status TEXT NOT NULL, task_id TEXT, trigger TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '[]', error TEXT);
  CREATE INDEX idx_runs_automation ON automation_runs(automation_id, created_at);

  -- time-based triggers that already fired (rule + task + date), so each fires once
  CREATE TABLE automation_fired (key TEXT PRIMARY KEY, created_at TEXT NOT NULL);

  CREATE TABLE jobs (${base},
    type TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
    run_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
    status TEXT NOT NULL DEFAULT 'pending', last_error TEXT);
  CREATE INDEX idx_jobs_due ON jobs(status, run_at);
  `,
  // ---- Phase 4: email accounts, mail store, outbox, templates, follow-up sequences, calendars
  `
  CREATE TABLE accounts (${base},
    kind TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
    config TEXT NOT NULL DEFAULT '{}', secret TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1, sync_state TEXT NOT NULL DEFAULT '{}',
    last_sync_at TEXT, last_error TEXT);

  CREATE TABLE mail_threads (${base},
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    subject TEXT NOT NULL DEFAULT '', norm_subject TEXT NOT NULL DEFAULT '',
    done INTEGER NOT NULL DEFAULT 0, last_message_at TEXT NOT NULL);
  CREATE INDEX idx_threads_account ON mail_threads(account_id, last_message_at);

  CREATE TABLE mail_messages (${base},
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL REFERENCES mail_threads(id) ON DELETE CASCADE,
    folder TEXT, uid INTEGER,
    message_id TEXT NOT NULL, in_reply_to TEXT, refs TEXT NOT NULL DEFAULT '[]',
    from_name TEXT NOT NULL DEFAULT '', from_addr TEXT NOT NULL DEFAULT '',
    to_addrs TEXT NOT NULL DEFAULT '[]', cc_addrs TEXT NOT NULL DEFAULT '[]',
    subject TEXT NOT NULL DEFAULT '', date TEXT NOT NULL, snippet TEXT NOT NULL DEFAULT '',
    body_text TEXT NOT NULL DEFAULT '', body_html TEXT,
    is_read INTEGER NOT NULL DEFAULT 0, is_outbound INTEGER NOT NULL DEFAULT 0, is_inbox INTEGER NOT NULL DEFAULT 0,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    UNIQUE (account_id, message_id));
  CREATE INDEX idx_messages_thread ON mail_messages(thread_id, date);
  CREATE INDEX idx_messages_reply ON mail_messages(account_id, in_reply_to);

  CREATE TABLE mail_attachments (${base},
    message_id TEXT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
    filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, stored_path TEXT);

  CREATE VIRTUAL TABLE mail_fts USING fts5(message_id UNINDEXED, subject, sender, body, tokenize = 'unicode61 remove_diacritics 2');

  CREATE TABLE email_task_links (
    thread_id TEXT NOT NULL REFERENCES mail_threads(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (thread_id, task_id));

  CREATE TABLE outbox (${base},
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    to_addrs TEXT NOT NULL, cc_addrs TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL, body TEXT NOT NULL,
    in_reply_to TEXT, refs TEXT NOT NULL DEFAULT '[]', thread_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued', error TEXT, sent_at TEXT,
    source TEXT NOT NULL DEFAULT 'manual', enrollment_id TEXT, message_id TEXT NOT NULL);

  CREATE TABLE email_templates (${base}, name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '');

  CREATE TABLE sequences (${base},
    name TEXT NOT NULL, send_window TEXT NOT NULL, daily_cap INTEGER NOT NULL DEFAULT 50);
  CREATE TABLE sequence_steps (${base},
    sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, wait_days REAL NOT NULL, body TEXT NOT NULL);
  CREATE TABLE sequence_enrollments (${base},
    sequence_id TEXT NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL REFERENCES mail_threads(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    to_addrs TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
    current_step INTEGER NOT NULL DEFAULT 0, next_run_at TEXT, enrolled_at TEXT NOT NULL,
    last_sent_at TEXT, last_queued_at TEXT, stopped_reason TEXT);
  CREATE INDEX idx_enrollments_due ON sequence_enrollments(status, next_run_at);

  CREATE TABLE calendars (${base},
    account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
    url TEXT, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#3b82f6',
    ctag TEXT, enabled INTEGER NOT NULL DEFAULT 1, read_only INTEGER NOT NULL DEFAULT 0);

  CREATE TABLE calendar_events (${base},
    calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    uid TEXT NOT NULL, href TEXT, etag TEXT,
    title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
    start TEXT NOT NULL, end TEXT NOT NULL, all_day INTEGER NOT NULL DEFAULT 0,
    rrule TEXT, exdates TEXT NOT NULL DEFAULT '[]', raw TEXT,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    dirty INTEGER NOT NULL DEFAULT 0, pending_delete INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX idx_events_calendar ON calendar_events(calendar_id, start);
  `,
  // ---- Phase 5: AI assistant, usage log, email triage
  `
  CREATE TABLE ai_conversations (${base},
    title TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
    system TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'idle', error TEXT);

  -- native = the provider's own message format, replayed verbatim (append-only);
  -- view = what the chat UI shows (text + tool call cards)
  CREATE TABLE ai_messages (${base},
    conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL, role TEXT NOT NULL, native TEXT NOT NULL, view TEXT);
  CREATE INDEX idx_ai_messages ON ai_messages(conversation_id, seq);

  CREATE TABLE ai_usage (${base},
    feature TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cache_read_tokens INTEGER NOT NULL DEFAULT 0);

  ALTER TABLE mail_threads ADD COLUMN ai_category TEXT;
  ALTER TABLE mail_threads ADD COLUMN ai_priority INTEGER;
  ALTER TABLE mail_threads ADD COLUMN ai_summary TEXT;
  ALTER TABLE mail_threads ADD COLUMN ai_triaged_at TEXT;
  `,
  // ---- Phase 6: Slack / Teams integrations
  `
  -- secret = encrypted webhook URL or bot token; config = channel, mirroring and watch settings
  CREATE TABLE integrations (${base},
    kind TEXT NOT NULL, name TEXT NOT NULL, secret TEXT NOT NULL DEFAULT '',
    config TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1,
    last_error TEXT, last_used_at TEXT);

  -- Slack messages already turned into tasks
  CREATE TABLE slack_imported (
    integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    ts TEXT NOT NULL, task_id TEXT, created_at TEXT NOT NULL,
    PRIMARY KEY (integration_id, ts));
  `,
  // ---- Hardening: indexes for hot paths, automated-mail flag (ADR-007, ADR-008)
  `
  CREATE INDEX IF NOT EXISTS idx_messages_uid ON mail_messages(account_id, folder, uid);
  CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);
  CREATE INDEX IF NOT EXISTS idx_checklists_task ON checklists(task_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);
  CREATE INDEX IF NOT EXISTS idx_email_links_task ON email_task_links(task_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
  CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);

  -- 1 = auto-reply, mailing list or bounce: never auto-replied to by automations
  ALTER TABLE mail_messages ADD COLUMN is_auto INTEGER NOT NULL DEFAULT 0;
  `,
  // ---- 1.0: images shown inside emails are files referenced by cid:, not data in body_html (ADR-010)
  `
  ALTER TABLE mail_attachments ADD COLUMN inline INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE mail_attachments ADD COLUMN content_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_mail_attachments_message ON mail_attachments(message_id, content_id);
  `
]

export function migrate(db: DatabaseSync): void {
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
}
