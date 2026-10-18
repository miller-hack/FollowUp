# Project history

> This is the original product and technical specification FollowUp was built from, kept up to date as each development phase was delivered (sections 1–14 describe the design; the later sections record what each phase and release added). For how things work **today**, the [user guide](../README.md) and the [architecture](architecture.md) page are the reference; where they differ, they win.

# FollowUp — Product & Technical Specification

> A single-user, offline-first Windows desktop work-management app inspired by ClickUp,
> centred on tasks, email, calendar and automation, with a built-in AI assistant.
>

---

## 1. Goals & Non-Goals

### Goals
- One desktop app that replaces a task manager, email follow-up tool, calendar view and personal AI assistant.
- Fully usable offline; all data stored locally on the user's PC.
- ClickUp-style flexible hierarchy, custom fields and multiple views.
- Turn email into work (email → task) and work into email (task → email, follow-up sequences).
- A no-code automation engine that ties tasks, email, calendar and notifications together.
- AI assistant that can read and act on the local workspace (with user confirmation for side effects).

### Non-Goals (v1)
- Multi-user collaboration, real-time co-editing, shared workspaces, permissions/RBAC.
- Cloud hosting, mobile apps, web app.
- Docs/Wiki and Whiteboards (candidates for a later version).
- Public REST API / webhooks *into* the app (no server to receive them).

### Future-proofing
- Data layer uses UUID primary keys, `created_at`/`updated_at`/`deleted_at` columns on every table so that cloud sync can be added later without schema rewrites.

---

## 2. Platform & Tech Stack

| Concern | Choice |
|---|---|
| Desktop shell | **Electron** (Windows 10/11 x64) |
| Build tooling | **electron-vite** (Vite for main, preload and renderer) |
| Language | **TypeScript** (strict) everywhere |
| UI | **React 18**, **Tailwind CSS**, Radix primitives / shadcn-style components, lucide-react icons |
| State | **Zustand** (UI state) + **TanStack Query** (data fetched over IPC) |
| Routing | React Router (hash router) |
| Database | **SQLite** via Electron's built-in **`node:sqlite`** (no native module to compile), thin typed SQL layer, versioned migrations on startup (`PRAGMA user_version`) |
| Search | SQLite **FTS5** virtual tables (tasks, comments, emails) |
| Board drag & drop | **dnd-kit** |
| Calendar view | **FullCalendar** (day / week / month) |
| Gantt view | Custom React/SVG Gantt (drag to move/resize, dependencies) |
| Charts | **Recharts** |
| Rich text | **TipTap** (task descriptions, comments, email templates) |
| Email | **googleapis** (Gmail API), **imapflow** (IMAP), **nodemailer** (SMTP), **mailparser** |
| Calendar sync | **googleapis** (Google Calendar), **tsdav** (CalDAV) |
| AI | Provider abstraction over **@anthropic-ai/sdk** (default), **openai**, **Ollama** (local) |
| Scheduling | Persistent job queue in SQLite + in-process scheduler in the main process |
| Secrets | Electron **safeStorage** (Windows DPAPI) for OAuth tokens, passwords and API keys |
| Notifications | Electron `Notification` (Windows toast), system tray |
| Packaging | **electron-builder** → NSIS installer; **electron-updater** for auto-update |
| Testing | **Vitest** (unit), **playwright-core** `_electron` (E2E smoke test) |

### Process architecture

```
┌──────────────────────────── Electron main process ────────────────────────────┐
│  DB (better-sqlite3 + Drizzle)   Repositories / Services                      │
│  Job queue & scheduler           Automation engine                            │
│  Mail/Calendar sync workers      AI provider gateway                          │
│  Secret store (safeStorage)      Notifications / Tray / Auto-update           │
└───────────────▲───────────────────────────────────────────────────────────────┘
                │ typed IPC (contextBridge, invoke/handle + event push)
┌───────────────┴────────── Preload ───────────┐
│  window.api  — whitelisted, typed methods     │
└───────────────▲───────────────────────────────┘
┌───────────────┴────────── Renderer (React) ───┐
│  Views, components, Zustand, TanStack Query   │
└───────────────────────────────────────────────┘
```

- Renderer runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- All DB, network and secret access happens in the main process only.
- IPC contract is defined once in `src/shared/ipc.ts` and shared by main, preload and renderer.
- Main process emits change events (`entity:changed`) so open views refresh live.

---

## 3. Information Architecture

```
Workspace (exactly one in v1, but modelled as a table)
 └─ Space            (e.g. "Work", "Personal")   — colour, icon, default statuses
     ├─ Folder       (optional grouping)
     │   └─ List
     └─ List         (lists may live directly in a Space)
         └─ Task
             └─ Subtask (a Task with parent_id; unlimited nesting, UI shows 2 levels by default)
```

Statuses are defined per Space (inherited by Lists, overridable per List). Each status has a
name, colour, order and a type: `open | active | done | closed`.

---

## 4. Data Model (SQLite)

All tables: `id TEXT PK (uuid)`, `created_at`, `updated_at`, `deleted_at NULL` (soft delete).

| Table | Key columns |
|---|---|
| `workspaces` | name |
| `spaces` | workspace_id, name, color, icon, order |
| `folders` | space_id, name, order |
| `lists` | space_id, folder_id NULL, name, color, order, status_set_id NULL |
| `statuses` | space_id NULL, list_id NULL, name, color, type, order |
| `tasks` | list_id, parent_id NULL, title, description (TipTap JSON), status_id, priority (`urgent/high/normal/low/none`), start_date, due_date, time_estimate_min, order, completed_at, source (`manual/email/ai/automation/slack`), source_ref |
| `tags` / `task_tags` | name, color / task_id, tag_id |
| `custom_field_defs` | workspace_id, scope (space/list), name, type (`text, number, money, date, dropdown, labels, checkbox, url, email, phone, rating, progress`), options JSON |
| `custom_field_values` | task_id, field_id, value JSON |
| `checklists` / `checklist_items` | task_id, name / checklist_id, text, done, order |
| `comments` | task_id, body (rich), author (`me/ai/automation`) |
| `attachments` | task_id, file_name, mime, size, stored_path (copied into app data dir) |
| `task_dependencies` | task_id, depends_on_task_id, type (`blocks/waiting_on`) |
| `activity_log` | entity_type, entity_id, action, diff JSON |
| `views` | list_id/space_id, type (`list/board/calendar/gantt`), config JSON (filters, sort, group by, visible columns) |
| `time_entries` | task_id, started_at, ended_at, duration_min, note, billable |
| `goals` / `key_results` | name, due_date, color / goal_id, type (`number/percent/boolean/tasks`), target, current, linked_task_ids |
| `sprints` | list_id, name, start_date, end_date, status |
| `dashboards` / `dashboard_widgets` | name / dashboard_id, type, config JSON, layout |
| `reminders` | task_id NULL, remind_at, message, done |
| `notifications` | type, title, body, entity ref, read_at |
| `automations` | name, enabled, trigger JSON, conditions JSON, actions JSON, last_run_at |
| `automation_runs` | automation_id, status, input, output, error |
| `jobs` | type, payload JSON, run_at, attempts, max_attempts, status, last_error |
| `accounts` | provider (`gmail/imap/google_cal/caldav/slack/teams/ai`), display_name, config JSON, secret_ref |
| `email_threads` / `email_messages` | account_id, provider ids, subject, from, to, cc, date, snippet, body_html/text, labels, is_read, ai_summary, ai_category, ai_priority |
| `email_task_links` | email_thread_id, task_id |
| `email_templates` | name, subject, body (with `{{variables}}`) |
| `sequences` / `sequence_steps` / `sequence_enrollments` | follow-up sequences (see §7.3) |
| `calendars` / `calendar_events` | account_id, provider ids, title, start, end, all_day, location, attendees, task_id NULL |
| `ai_conversations` / `ai_messages` | assistant chat history, tool calls & results |
| `settings` | key, value JSON |

FTS5 virtual tables: `tasks_fts(title, description_text)`, `comments_fts`, `emails_fts(subject, from, body_text)`.

---

## 5. Feature Specification — Core (Phase 1)

### 5.1 Sidebar & navigation
- Tree of Spaces → Folders → Lists with create / rename / recolour / reorder (drag) / archive / delete.
- Quick links: Home, Inbox (email), Calendar, Dashboards, Goals, Time, Automations, AI Assistant, Settings.
- Global search (`Ctrl+K`): command palette that searches tasks, lists, emails and runs commands.
- Quick-add task (`Ctrl+N`) from anywhere.

### 5.2 Tasks
- Fields: title, rich description, status, priority, start/due date (with time), time estimate, tags, custom fields, assignee is implicitly "me" in v1.
- Subtasks, checklists, comments, attachments (files copied into app storage), dependencies.
- Task detail panel (slide-over) and full-page mode; activity history.
- Bulk actions: multi-select → change status/priority/due/tags, move, delete.
- Recurring tasks (daily/weekly/monthly/custom RRULE) — on completion, next instance is created.

### 5.3 Views (per List, Folder or Space; saved per location)
| View | Behaviour |
|---|---|
| **List** | Table grouped by status (or priority/due/tag); inline edit; sortable/resizable columns incl. custom fields; collapse groups; subtasks expandable |
| **Board** | Kanban columns by status (or priority); drag cards between/within columns; card shows priority, due, tags, subtask progress |
| **Calendar** | Month/week/day; tasks placed by due (or start→due) date; drag to reschedule; also shows synced calendar events (Phase 4) |
| **Gantt** | Timeline bars from start→due; drag to move/resize; dependency arrows; zoom day/week/month; "today" line |

Common to all views: filter builder (status, priority, tag, due range, custom field), sort, group-by, search-within-view, "show closed" toggle.

### 5.4 Home
"My Work": overdue, today, upcoming 7 days, unscheduled; recent activity; today's calendar.

### 5.5 Settings (Phase 1 subset)
Theme (light/dark/system), start-of-week, date format, data folder location, export/import (JSON), backup now / auto-backup (daily SQLite copy, keep 14).

---

## 6. Feature Specification — Planning & Tracking (Phase 2)

- **Time tracking:** start/stop timer on any task (one running at a time, shown in title bar & tray), manual entries, timesheet view (week grid), estimates vs actual, export CSV.
- **Goals:** goals with key results (numeric, percentage, true/false, or "tasks complete" linked to tasks); progress auto-computed.
- **Sprints:** sprint lists with start/end dates; move incomplete tasks to next sprint; burndown chart.
- **Dashboards:** grid of widgets — task count by status/priority, tasks completed over time, time tracked by list/tag, goal progress, overdue list, calendar agenda, email follow-ups pending. Drag/resize layout.
- **Reminders & notifications:** reminders on tasks or standalone; due-date notifications (configurable lead time); Windows toast + in-app notification centre; daily digest at chosen time.

---

## 7. Feature Specification — Automation, Email & Calendar (Phases 3–4)

### 7.1 Automation engine
Rule = **Trigger → Conditions → Actions**.

- **Triggers:** task created / status changed / priority changed / due date arrives / overdue / moved to list / tag added / comment added / checklist completed; email received (matching filter); email not replied after N days; calendar event starts in N min; schedule (cron-like); time tracked exceeds estimate.
- **Conditions:** field comparisons (status, priority, list, tag, custom field), email from/to/subject/body contains, AI classification equals.
- **Actions:** create task/subtask, change status/priority/due, add tag, move task, add comment, create reminder, send notification, send email (template), reply to email, enroll in sequence, create calendar event, post to Slack/Teams, run AI prompt (summarise / classify / draft) and store result.
- Execution through the persistent job queue with retries (exponential backoff, max attempts), run log per rule, loop protection (max chain depth 5), dry-run "test rule" button.
- Template library of common rules.

### 7.2 Email & calendar accounts
- **Gmail + Google Calendar:** OAuth 2.0 (desktop loopback redirect + PKCE). User supplies their own Google Cloud OAuth client ID (setup guide in-app). Incremental sync via Gmail `history` API and Calendar `syncToken`.
- **IMAP/SMTP:** host/port/TLS + username/app password; IDLE for new mail, periodic resync; presets for Gmail, Outlook.com, Yahoo, Zoho, iCloud.
- **CalDAV:** URL + credentials; periodic sync with ctag/etag.
- Inbox UI: unified inbox, per-account folders/labels, thread view, compose/reply/forward with templates, search (FTS).
- Calendar UI: merged view of tasks + events; create event from task and vice-versa; two-way sync of event changes.

### 7.3 Email automation
- **Email → Task:** one-click "Create task" from any email (links thread to task, attachments optional); rule-based auto-creation.
- **Task → Email:** send templated emails on task events (`{{task.title}}`, `{{task.due_date}}`, `{{contact.name}}`…).
- **Follow-up sequences:** a sequence is ordered steps (`wait N days` → `send template`), enrolled per thread/contact. Enrollment stops automatically when a reply is detected, when the user replies manually, or on bounce. Send windows (e.g. weekdays 9–17), daily send cap, per-step preview.
- **AI triage & drafting:** summarise thread, classify (action needed / FYI / newsletter / follow-up / spam-ish), priority score, extract tasks & dates, suggest reply drafts (never auto-sent without an explicit rule).
- The app lives in the system tray and can start at login so scheduled sends and sync continue while the window is closed. Missed sends (PC was off) are sent on next start or skipped per setting.

---

## 8. Feature Specification — AI (Phase 5)

- **Providers:** Anthropic Claude (default model `claude-opus-5-5`; Sonnet 5.5, Haiku 5.5 and Fable 5.1 selectable), OpenAI, Ollama (local, offline). Keys stored via safeStorage. (As built: one model per provider, chosen in Settings → AI; see §18.)
- **AI Assistant chat:** side panel available everywhere. Uses tool calling against local services:
  `search_tasks`, `get_task`, `create_task`, `update_task`, `search_emails`, `get_thread`, `draft_email`, `list_events`, `create_event`, `get_time_report`, `create_automation`.
  Write actions show a confirmation card before execution. Conversation history stored locally.
- **Inline AI:** summarise task/comments, generate subtasks, rewrite text, natural-language quick-add ("Call John next Tue 3pm #sales high"), weekly review report.
- **Privacy:** only the data needed for a request is sent to the provider; a setting allows "local model only".

---

## 9. Integrations (Phase 6)

- **Slack:** incoming webhook or bot token → post notifications/automation messages to channels; optional polling of a chosen channel to turn messages with a chosen reaction into tasks.
- **Microsoft Teams:** incoming webhook (Workflows) → post notifications.
- Calendar export as `.ics`; data export JSON/CSV.

---

## 10. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Performance | Cold start < 3 s; list/board with 5 000 tasks renders < 300 ms (virtualised lists); search < 100 ms |
| Reliability | SQLite WAL mode; all writes in transactions; daily automatic backups; jobs survive restarts |
| Security | Context isolation + sandboxed renderer; strict CSP; secrets only in main process via DPAPI; no remote code; OAuth with PKCE; external links open in default browser |
| Privacy | No telemetry by default; all data local; AI calls opt-in |
| Accessibility | Keyboard navigation for all views, visible focus, ARIA labels on Radix components |
| Updates | NSIS installer (signed when a certificate is configured); auto-update from a static HTTPS folder |
| Data portability | Full JSON export/import; SQLite file is the source of truth and can be copied |

---

## 11. Project Structure

```
follow-up/
├─ SPEC.md          # this document (now docs/developer/project-history.md)
├─ package.json
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ src/
│  ├─ shared/            # types & IPC contract shared by all processes
│  ├─ main/
│  │  ├─ index.ts        # app lifecycle, window, tray
│  │  ├─ db/             # node:sqlite client, migrations
│  │  ├─ services/       # tasks, hierarchy, views, search, ...
│  │  └─ ipc/            # ipcMain handlers
│  ├─ preload/index.ts   # contextBridge → window.api
│  └─ renderer/
│     ├─ index.html
│     └─ src/
│        ├─ app/         # routes, layout
│        ├─ components/  # UI primitives
│        ├─ features/    # sidebar, tasks, views/{list,board,calendar,gantt}, home, settings
│        ├─ lib/         # api client, query hooks, utils
│        └─ stores/
└─ tests/
```

---

## 12. Delivery Phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **1. Foundation & core tasks** | Scaffold, DB + migrations, IPC, hierarchy, tasks (fields, subtasks, checklists, comments, tags, custom fields, attachments), List/Board/Calendar/Gantt views, filters, search, Home, settings basics, backups | Can manage real projects end-to-end offline |
| **2. Planning & tracking** | Time tracking, goals, sprints, dashboards, reminders, notifications, tray | Timer, goals and dashboards working with real data |
| **3. Automation engine** | Job queue, triggers/conditions/actions for tasks & notifications, run log, templates | Rules fire reliably across restarts |
| **4. Email & calendar** | Gmail/GCal, IMAP/SMTP/CalDAV, inbox UI, calendar sync, email↔task, sequences | Follow-up sequence sends and stops on reply |
| **5. AI** | Provider settings, assistant chat with tools, triage, drafting, NL quick-add | Assistant can answer and act on workspace |
| **6. Integrations & release** | Slack/Teams, installer, auto-update, E2E tests | Signed installer installs and updates |

---

## 13. Known Constraints

- Scheduled emails/sync only run while the app (or its tray process) is running.
- Gmail API restricted scopes: personal use works with an OAuth client in "Testing" mode (refresh tokens expire every 7 days); public distribution requires Google verification. IMAP + app password is the zero-setup alternative.
- Slack "create task from message" relies on polling (no public endpoint for event webhooks).
- `better-sqlite3` was evaluated but has no prebuilt binary for Electron 44 and needs Python + VS Build Tools to compile; Electron's built-in `node:sqlite` (SQLite 3.53, FTS5 included) is used instead.
- Phase 1 uses hard deletes (with confirmation + daily backups); the `deleted_at` column is reserved for trash/sync later.

## 14. Phase 1 status (done)

Implemented: hierarchy (spaces/folders/lists, colors, statuses editor), tasks with subtasks, checklists, comments,
attachments, dependencies (cycle-safe), tags, 12 custom field types, recurrence, activity log; List (grouping, sorting,
inline edit, bulk actions), Board (drag & drop), Calendar (drag/resize), Gantt (drag/resize, dependency arrows, zoom);
filters + saved per-location view settings; FTS search + command palette (`Ctrl+K`); quick add (`Ctrl+N`); Home "My Work";
settings (theme, week start, tags), daily auto-backup, JSON export. Unit tests (`npm test`) and E2E smoke test (`npm run e2e`).

Deferred from Phase 1: sidebar drag-to-reorder (API exists: `reorder`), JSON import, list virtualisation for very large lists.

## 15. Phase 2 status (done)

Implemented:
- **Time tracking** — one running timer (task panel, list rows, sidebar, tray menu, window title), manual entries,
  entries < 5 s discarded, weekly timesheet grid with inline duration edit, CSV export (Excel-friendly), tracked vs estimate.
- **Goals** — key results of type number / percent / currency / true-false / linked tasks; progress auto-computed.
- **Sprints** — per space, shown under the space in the sidebar; any view works on a sprint (`/l/sprint/:id`);
  start / complete (unfinished tasks roll into the next sprint, created if needed); burndown (remaining vs ideal).
- **Dashboards** — default "Overview" plus custom dashboards; 9 widget types (number, by status, by priority,
  completed trend, time by list/tag, task list, goals, sprint burndown), scope per widget, drag to reorder, 1–4 column width.
  Charts use a fixed, CVD-validated categorical palette with separate dark-mode steps; every breakdown is also a labeled list.
- **Reminders & notifications** — task and standalone reminders, due-date notifications (lead time for timed due dates,
  configurable time of day for date-only), daily summary, Windows toasts (click opens the task), in-app notification center.
- **Desktop** — system tray (open, new task, timer status/stop, quit), close-to-tray, start at login (installed app only, starts hidden).

Schema: migration 2 (`sprints`, `tasks.sprint_id`, `time_entries`, `goals`, `key_results`, `key_result_tasks`, `dashboards`,
`dashboard_widgets`, `reminders`, `notifications`, `notify_log`).

## 16. Phase 3 status (done)

- **Engine** — services emit domain events inside their transaction; matching enabled rules queue an `automation` job in the
  persistent `jobs` table (survives restarts, `running` jobs recovered at startup, exponential backoff 30 s → 1 h, max 3 attempts).
  Conditions are evaluated when the job runs; all actions of a run execute in one transaction (a failing action rolls back the
  earlier ones and the job retries). Toasts from `notify` actions are only shown after the commit.
- **Loop protection** — every event carries its automation depth; chains stop at depth 5 with a "skipped" run entry.
  Comments written by automations never trigger comment rules.
- **Triggers** — task created, status changed (from/to, matched by status *name* so rules work across spaces), priority changed,
  moved to list, tag added, comment added, checklist completed, tracked time exceeds estimate (once per estimate),
  due date arrives (0/1/2/3/7 days before), task overdue (once per task + due date), schedule (daily / weekdays / weekly / monthly
  at a time; never fires for a moment that passed before the rule was created).
- **Conditions** — status, priority, list, tag, title, due date set, sprint set, custom field (is / is not / contains / > / < / set).
- **Actions** — set status / priority / due date, add / remove tag, move to list, comment (with `{{task.*}}` / `{{date.today}}`
  variables), create subtask, add checklist, create task, create reminder, notify, set custom field.
- **UI** — Automations page with on/off switch, plain-English summaries, run counts, 8 templates, editor (WHEN / IF / THEN),
  dry-run test against any task, "run now" (manual / schedule rules), run history (last 100 per rule) with per-action detail.

The `jobs` queue is generic (`registerJobHandler`) and will carry Phase 4's email sends and sync work.

Schema: migration 3 (`automations`, `automation_runs`, `automation_fired`, `jobs`).

## 17. Phase 4 status (done — IMAP/SMTP + CalDAV; Google/Microsoft sign-in deferred)

- **Accounts** — IMAP/SMTP with an app password (presets: Gmail, iCloud, Yahoo, Zoho, Fastmail, Outlook*, custom) and CalDAV.
  Passwords encrypted with Electron `safeStorage` (Windows DPAPI). "Test connection" checks IMAP and SMTP separately with
  human-readable errors. Remote servers always use TLS (implicit or required STARTTLS).
  *Microsoft has disabled app-password sign-in for most Outlook.com accounts; the preset says so.
- **Sync** — INBOX + Sent, first sync imports `syncDays` (≤ 500 messages) silently; later syncs are incremental by UID
  (UIDVALIDITY change → resync), refresh read state for recent mail, background every N minutes (setting) + on demand.
  Threading by Message-ID / In-Reply-To / References, with a subject + participant fallback.
  Attachments ≤ 10 MB kept on disk; inline `cid:` images embedded. FTS search over subject/sender/body.
- **Reading safely** — HTML sanitised on import (scripts, iframes, forms, event handlers, `javascript:` links removed) and
  rendered in a sandboxed iframe with its own CSP: no scripts, links open in the browser, remote images (tracking pixels)
  blocked unless the user clicks "Show images" or enables them in Settings. Frames can't navigate in place.
- **Sending** — outbox + `mail_send` job (5 attempts with backoff, error visible while retrying, retry/cancel), replies are
  threaded (In-Reply-To/References), copy appended to Sent when the provider doesn't do it, message appears in the thread.
  Compose: from-account, to/cc, templates, reply / reply-all (quoted) / forward, Ctrl+Enter.
- **Email ↔ task** — "Create task" from a thread (subject, sender + body as description, linked both ways); task panel shows
  linked emails, "Email" and "Block time" (calendar event from due date + estimate).
- **Follow-up sequences** — steps (wait N days → reply in the same thread with `{{first_name}}`, `{{name}}`, `{{subject}}`),
  send window (days + hours), per-sequence daily cap. Stops automatically on any reply, on bounce (mailer-daemon /
  "Undeliverable"), or when you reply yourself; one active follow-up per thread. Missed while offline > 1 day: send or skip
  (setting). Inbox shows status and next send; Follow-ups page lists sequences, people in progress, email templates.
- **Calendar** — built-in local calendar plus CalDAV calendars (push local edits first, then pull −90…+366 days, ctag
  short-circuit, server wins on conflicts, recurring events expanded with ical.js, series times read-only).
  Calendar page shows events and task due dates; create by selecting, drag/resize to move.
- **Automations** — new triggers: email received (optionally per account), sent email gets no reply in N days, calendar event
  starts in N minutes; email conditions (sender, recipients, subject, body); actions: send email, create task from email, reply,
  start follow-up sequence, mark read. The editor only offers actions/conditions/variables valid for the trigger.

Schema: migration 4 (`accounts`, `mail_threads`, `mail_messages`, `mail_attachments`, `mail_fts`, `email_task_links`, `outbox`,
`email_templates`, `sequences`, `sequence_steps`, `sequence_enrollments`, `calendars`, `calendar_events`).

Tests: `tests/mail.test.ts` runs real IMAP (hoodiecrow-imap) and SMTP (smtp-server) servers in-process; the E2E smoke test
adds an account through the Settings UI against local servers.

Deferred to later phases: Google / Microsoft OAuth (Gmail API, Google Calendar, Graph), IMAP IDLE push, folders other than
INBOX/Sent, attachments when composing, AI triage & drafting (Phase 5).

## 18. Phase 5 status (done — AI)

- **Providers** — Claude via `@anthropic-ai/sdk` (default `claude-opus-5-5`, adaptive thinking, effort low/medium/high,
  streaming, prompt caching, structured JSON output). Server-side refusal fallback (`fallbacks: "default"`) is on for
  Opus 5.5 / Opus 5 / Fable 5.1 / Fable 5 / Sonnet 5.5 (not Haiku). OpenAI and Ollama share an OpenAI-compatible adapter.
  Keys encrypted with `safeStorage` and never sent to the renderer (it only sees "key saved").
- **Assistant** (side panel, Ctrl+J, sidebar "AI assistant") — streaming replies, conversation list, stop, delete.
  Read tools run automatically (workspace, tasks, my work, emails, threads, events, time report, goals, sequences);
  write tools (create/update task, comment, event, reminder, start follow-up) show approval cards (approve / decline /
  approve all). `draft_email` opens Compose; the assistant never sends mail. History is append-only native provider
  messages (thinking blocks and signatures kept), the system prompt is frozen per conversation, current time goes in a
  `<context>` line on each user message. Max 12 tool steps per message; crashed "running" chats recover as idle.
- **Inline AI** — task panel ✨ menu: summarize (→ add as comment), suggest subtasks (pick → add), rewrite description
  (5 styles, preview → replace), "ask the assistant". Quick add: ✨ / Alt+Enter turns natural language into title, due
  date/time, priority and #tags (missing tags are created). Home: "Review my week".
  Inbox ✨ menu: summarize thread, draft a reply (optional instructions → Compose with quoted history), find tasks
  (pick list → create + link), sort this email.
- **Email triage** — optional "Sort new email automatically" (off by default; sends each new inbox email to the provider)
  + "Sort current inbox now". Categories: Needs action, Needs reply, FYI, Newsletter, Notification, Likely spam, with
  priority and a one-line summary; shown as chips with a category filter in the inbox.
- **Automations** — trigger "AI classifies a new email" (optionally a category); action "Ask AI (answer as comment)"
  runs as a background job.
- **Usage** — Settings → AI shows this month's tokens, calls per feature and an estimated cost for Claude
  (cache reads priced at the cache rate).

Schema: migration 5 (`ai_conversations`, `ai_messages`, `ai_usage`; `mail_threads.ai_category/ai_priority/ai_summary/ai_triaged_at`).

Tests: `tests/ai.test.ts` drives the real Claude adapter against a fake streaming Messages API (request shape, append-only
replay, approvals, refusal, structured output, triage → automation, OpenAI streamed tool calls). The E2E smoke test points
the app at a fake Claude server (`ANTHROPIC_BASE_URL`) and covers settings, inbox AI, assistant approval, task subtasks,
quick-add parsing and the weekly review.

Not done (later): per-feature model choice, "local model only" privacy switch (choose Ollama instead), assistant-created
automations, Slack/Teams (Phase 6).

## 19. Phase 6 status (done — integrations & release)

- **Slack & Microsoft Teams** (Settings → Slack & Teams) — Slack incoming webhook, Slack app (bot token + channel) or
  Teams Workflows webhook. Secrets encrypted with DPAPI and never sent to the renderer (it sees only the host / channel).
  Webhooks must be HTTPS (Slack: hooks.slack.com). "Send test message" before saving. Messages go through the job queue
  (4 attempts with backoff); revoked webhooks / tokens stop retrying and show a plain-English error on the card.
  Options per integration: mirror FollowUp notifications (due dates, reminders, daily summary, automation notifications);
  Slack app only: turn messages with a chosen reaction (default `:memo:`) in the channel into tasks in a chosen list —
  polled every 2 minutes, last 7 days, each message once, with a permalink back to Slack. Task panel: "Send to Slack /
  Teams". Automation action "Post to Slack / Teams" with template variables.
- **Sign in with Google / Microsoft** — authorization code + PKCE with a one-off loopback redirect in the user's own
  browser (no embedded login window). Google adds Gmail (IMAP/SMTP via XOAUTH2) and Google Calendar (CalDAV with a bearer
  token); Microsoft adds Outlook.com / Microsoft 365 mail (IMAP/SMTP via XOAUTH2). Refresh tokens are stored encrypted in
  the account; access tokens only in memory, refreshed one at a time, dropped and refreshed when a server rejects them.
  Revoked / expired sign-ins show "Sign in again". Signing in again with the same address updates the existing accounts
  (also converts an app-password account). Client IDs: each user creates one (guided dialog), or a build ships defaults
  via `MAIN_VITE_GOOGLE_CLIENT_ID` / `MAIN_VITE_GOOGLE_CLIENT_SECRET` / `MAIN_VITE_MICROSOFT_CLIENT_ID`.
- **Installer** — NSIS, per-user (no admin), choice of folder, Start-menu + desktop shortcuts, generated icon
  (`npm run icon`), data kept on uninstall. `npm run dist` (scripts/dist.mjs) builds it; signing via `CSC_LINK` /
  `CSC_KEY_PASSWORD` or Azure Trusted Signing.
- **Auto-update** — electron-updater from a static HTTPS folder (`FOLLOWUP_UPDATE_URL` at build time, or Settings →
  Updates). Checks at startup and every 6 h, downloads in the background, "Restart to update" in the sidebar, tray and
  settings; otherwise installs on quit. Only HTTPS feeds (localhost allowed for testing).
- **Calendar export** — `.ics` with events (recurring ones expanded) and open tasks with due dates, −90…+366 days.
- **Fixes** — automation list now names accounts / sequences correctly; dialogs are labelled for screen readers;
  async actions refresh the UI when they finish.

Schema: migration 6 (`integrations`, `slack_imported`).

Tests: `tests/phase6.test.ts` (fake Slack / Teams / OAuth / CalDAV servers, hoodiecrow IMAP and smtp-server with XOAUTH2:
PKCE sign-in, token refresh after a rejected token, revoked sign-in, Slack reaction → task, revoked webhook, .ics);
E2E connects Slack through the UI; `npm run test:update` builds 0.6.0 and 0.6.1, installs 0.6.0 silently, lets it update
itself from a local server, checks that 0.6.1 is installed and relaunched, then uninstalls.

Not done: Microsoft calendar (Outlook calendars need Microsoft Graph; Microsoft has no CalDAV), Teams → tasks (needs a
public bot endpoint), Gmail API push (IMAP polling is used), code-signing certificate (must be bought by the publisher).
## 20. Hardening release 0.6.1 (full code review)

A full code review found 6 high, 12 medium and 5 low issues; all are fixed (decisions in [ADR-001 to 008](../decisions/README.md)).
- **Untrusted files:** attachments are stored under sanitised names in their own folder with Mark of the Web; programs, scripts and shortcuts from email are never launched (warning plus Show in folder).
- **Window and IPC:** the main frame only ever shows the app page; IPC answers only that page; dropped files can't navigate the window.
- **Failure isolation:** one bad message, calendar event or follow-up step no longer stops its mailbox, calendar or queue; problems show on the account or follow-up.
- **At-most-once sending:** an email is recorded as sent as soon as the server accepts it; Compose can't double-send.
- **Validation:** dates (`YYYY-MM-DD[THH:mm]`) and task structure (parent cycles, foreign statuses) are checked in the services; rendering errors are contained to one region.
- **Mail loops:** automations never auto-reply to auto-replies, lists or robots, and email a recipient at most once per rule per day.
- **Data:** migration 7 indexes; daily retention and cleanup; attachment files removed with their tasks; export v2 includes automations, templates, sequences and the local calendar, and no secrets.
- **UX:** dialogs ask before discarding unsaved work; typed dates save once.
- **Dependencies:** nodemailer 10, mailparser 3.9, imapflow 2, react-router 7.18, vitest 4 (0 critical/high advisories).

Deferred: Tiptap 3 migration, list virtualisation, code signing.

## 21. Release 1.0.0

The first full release. Its problems were found on a real installation of 0.6.1; decisions in [ADR-009 to 012](../decisions/README.md).
- **One identity: always "FollowUp", never "Electron".**
  - Development and test runs use their own Windows app id and never show system notifications, so they can't register an "Electron" Start-menu entry under FollowUp's id.
  - The Apps list shows "FollowUp".
- **Closing the window:**
  - The first time, FollowUp asks whether to keep running in the background (reminders, timers, follow-ups) or quit, and explains how to reopen it: the Start menu, the desktop icon or the tray icon.
  - The answer is remembered and can be changed in Settings → Window & startup.
- **Fast start:** the window opens straight away; backup, maintenance and compaction run a few seconds later.
- **Mail storage:**
  - Pictures inside emails are kept once per account as files and shown again when a message is opened; they're no longer base64 inside the database.
  - Mail stored by older versions is converted once, after a fresh backup.
  - The database returns free space to the disk; backups are capped at 2 GB, always keeping the newest 3.
- **Editor:** Tiptap 3. **Lists:** the list view renders only the rows on screen, so thousands of tasks scroll smoothly.
- **Quality:**
  - Component tests for the screens (jsdom), a GitHub Actions pipeline on Windows, and a release test that can no longer touch an installed FollowUp.
  - `npm audit`: 0 advisories.

Still open: code signing. It needs a certificate, or an Azure Trusted Signing account, in the publisher's name; until then Windows SmartScreen shows a warning on first install.
