# FollowUp documentation

This folder is the complete manual for FollowUp, for people who **use** it and for people who want to **change** it.

## How each guide chapter is written

Every feature is described in the same order, so you can stop reading at the depth you need:

1. **What it's for** — the problem it solves and when to reach for it.
2. **How to use it** — step by step, with every option explained.
3. **Behind the scenes** — what the app actually does: which rules apply, what is stored, when background work runs, and which source files implement it. Read this when you want to understand exact behaviour or customize it.
4. **How it connects** — the other features it feeds or listens to.
5. **Examples** — short, realistic situations.

## User guide

| # | Chapter | Covers |
|---|---|---|
| 1 | [Getting started](guide/01-getting-started.md) | Install, first launch, the main window, closing vs quitting, the tray, keyboard shortcuts, where your data lives, how FollowUp starts up |
| 2 | [Workspace](guide/02-workspace.md) | Spaces, folders and lists; statuses and status types; custom fields; tags |
| 3 | [Tasks](guide/03-tasks.md) | Creating tasks (all ways), every field of the task panel, subtasks, checklists, dependencies, recurrence, reminders, comments, attachments, activity, search |
| 4 | [Views](guide/04-views.md) | List, Board, Calendar and Gantt views; filters, grouping and sorting; bulk edit; Everything; Home |
| 5 | [Planning](guide/05-planning.md) | Time tracking and timesheets, sprints and burndown, goals and key results, dashboards, reminders and notifications |
| 6 | [Email](guide/06-email.md) | Connecting accounts, how sync works, reading safely, replying and composing, email ↔ task links |
| 7 | [Follow-up](guide/07-follow-ups.md) | Reply needed / waiting on them, working days, AI-written follow-ups, snooze, settings |
| 8 | [Calendar](guide/08-calendar.md) | Local and CalDAV calendars, events, task due dates, block time, .ics export |
| 9 | [Automations](guide/09-automations.md) | The rules engine in depth: every trigger, condition, action and variable; testing; loop protection; recipes |
| 10 | [AI](guide/10-ai.md) | Providers and models, the assistant and its tools, inline AI, inbox triage, privacy and cost |
| 11 | [Slack & Teams](guide/11-integrations.md) | Webhooks, the Slack app, mirroring notifications, Slack reaction → task |
| 12 | [Settings & data](guide/12-settings-and-data.md) | Every setting, backups and restore, export, maintenance, moving to a new PC, the security and privacy model |
| 13 | [Scenarios](guide/13-scenarios.md) | End-to-end workflows that combine features for real situations |
| 14 | [Troubleshooting](guide/14-troubleshooting.md) | Common problems, what causes them and how to fix them |
| 15 | [Clients](guide/15-clients.md) | Companies and their people, stages, owners, logged calls and meetings, import/export |

## Developer documentation

| Page | Covers |
|---|---|
| [Architecture](developer/architecture.md) | Processes, the typed IPC API, domain events, the job queue, the scheduler, start-up, security boundaries, the renderer |
| [Data model](developer/data-model.md) | Every database table and column, JSON columns, settings keys, conventions |
| [Customizing and extending](developer/customizing.md) | Step-by-step recipes: new automation triggers, actions and conditions, AI tools, settings, API methods, migrations, widgets, pages |
| [Testing](developer/testing.md) | Unit, component, end-to-end and release tests and how to write new ones |
| [Building and releasing](developer/building-and-releasing.md) | Dev mode, installers, versioning, auto-update, code signing, CI |
| [Project history](developer/project-history.md) | The original specification and what each development phase delivered |

## Design decisions

[decisions/](decisions/README.md) holds the architecture decision records (ADRs). Each one explains a non-obvious choice, the alternatives that were considered, and the trade-offs that were accepted.

## Glossary

| Term | Meaning |
|---|---|
| **Space** | The top level of your workspace (e.g. *Work*, *Personal*). Owns statuses, custom fields and sprints. |
| **Folder** | Optional grouping of lists inside a space (e.g. *Projects*). |
| **List** | Where tasks live (e.g. *Website Launch*). |
| **Status type** | Every status is *open*, *active* or *done*. Only *done* counts as finished. |
| **Location** | A space, folder, list or sprint: anything you can open as a view or scope an automation to. |
| **Follow-up** | A conversation waiting too long for a reply: from you (*Reply needed*) or from them (*Waiting on them*). |
| **Interaction** | A logged call, chat, meeting, event or note with a client, with who took part. |
| **Automation / rule** | *When* a trigger fires, *if* conditions pass, *then* run actions. |
| **Job** | A unit of background work stored in the database (sending an email, running a rule…), retried if it fails. |
| **Domain event** | An internal signal such as "task status changed" or "email received" that automations listen to. |
| **Triage** | AI classification of an email into a category, a priority and a one-line summary. |
