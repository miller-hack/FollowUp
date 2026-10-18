# 3. Tasks

## What they're for

A task is one thing to do. Everything else in FollowUp revolves around tasks:

- emails become tasks;
- tasks become calendar events;
- automations change tasks;
- time is tracked against tasks;
- goals and sprints are measured in tasks.

## Creating tasks: every way in

| Way | How | What it fills in |
|---|---|---|
| **Quick add** | `Ctrl+N`, the **＋** in the sidebar, **New task** on Home or in the tray | Title, list, priority, due date, tags. The list defaults to the list you're looking at, then the last list you used, then your first list. While you're viewing a sprint, new tasks join it. |
| **Quick add with AI** | Type a sentence such as *"Call Sam next Tue 3pm, urgent #sales"*, then press `Alt+Enter` or click ✨ | The AI splits it into title *"Call Sam"*, due date/time, priority *urgent* and tag *sales* (created if missing). Review the result, then press Enter. |
| **＋ Task** button | Top right of any list, folder, space or sprint page | Opens Quick add for that location. |
| **New task row** | At the end of each group in the List view, or **＋ Add task** under a Board column | Inherits the group: the status of that column, the priority group, or the due-date group (e.g. "Today"). |
| **Calendar click** | Click a day in a location's Calendar view | Quick add with that date (and time, if you clicked a time slot). |
| **Subtask** | Task panel → *Subtasks* → **Add subtask** | Lives in the parent's list. |
| **From an email** | Inbox → **Create task** → choose a list | Title = subject (without "Re:"/"Fwd:"), description = sender and latest message, linked to the thread. |
| **From AI** | Inbox AI menu → **Find tasks**, or ask the assistant | You pick which suggested tasks to create. |
| **From Slack** | React to a Slack message with your chosen emoji | Title = first line of the message, description with a link back to Slack. See [Slack & Teams](11-integrations.md). |
| **By automation** | Actions *Create task*, *Create subtask*, *Create task from the email* | See [Automations](09-automations.md). |
| **By repetition** | Completing a repeating task | The next occurrence. |

Quick add keys: **Enter** creates the task; **Ctrl+Enter** creates it and opens it; **Alt+Enter** asks the AI to fill in the details.

## The task panel

Click any task title to open the panel on the right; **Esc** or ✕ closes it.

![Task panel](../images/task.png)

### Header

| Element | What it does |
|---|---|
| Breadcrumb *Space › List › Parent* | Click the list name to **move** the task to another list (subtasks move with it); click the parent to open it. |
| **Share** icon | Send the task (title, status, due date, list) to a connected Slack or Teams channel. Only shown when one is connected. |
| ✨ **AI menu** | Summarize, suggest subtasks, rewrite the description, ask the assistant. See [AI](10-ai.md). |
| **Duplicate** | Copies title (+ " (copy)"), description, status, priority, dates, estimate, repeat, sprint, tags, custom fields and checklists. It doesn't copy subtasks, comments, attachments or time. |
| **Delete** | Deletes the task, its subtasks and their attachments (asks first). |

### Fields

| Field | How to use it | Notes |
|---|---|---|
| **Title** | Click and type; Enter or click away to save. | |
| **Status** | Pick from your space's statuses. | Moving into a *Done*-type status marks the task complete; moving out reopens it. "Waiting on N task(s)" appears when blockers are unfinished. |
| **Priority** | Urgent · High · Normal · Low · None. | Shown as coloured flags (red, orange, blue, grey). |
| **Start date / Due date** | Quick picks: *Today*, *Tomorrow*, *Next week* (next Monday), *In 2 weeks*; or type a date. Tick **Include time** for a time of day. *Clear date* removes it. | A typed date is saved when you press Enter or leave the field, never half-typed. Dates are stored as `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` in your local time. |
| **Time estimate** | Type `1h 30m`, `90m`, `2h` or `1.5` (= hours). | Compared with time tracked; turns amber when you go over. |
| **Time tracked** | **Start** / **Stop** the timer. | Only one timer runs at a time; starting another stops the first. |
| **Sprint** | Choose one of the space's open sprints, or *None*. | |
| **Reminders** | **+ Remind me**: in 1 hour, in 3 hours, tomorrow 9:00, 1 hour before due, or any date and time. | Creates a notification at that moment. Click ✕ on a chip to remove it. |
| **Repeat** | Daily, weekly, every 2 weeks, monthly, yearly. | Needs a due (or start) date to schedule the next one. See [Recurrence](#recurring-tasks). |
| **Tags** | Add with the tag icon, remove with ✕. | |
| **Custom fields** | One row per field of the space. | See [Workspace](02-workspace.md#custom-fields). |

### Description

A rich-text editor with bold, italic, strikethrough, heading, bullet and numbered lists, quote, code block and links (paste a URL, or use the link button: an empty link removes it). It **saves automatically** 0.8 seconds after you stop typing and when you click away.

### Sections below the description

| Section | What you can do |
|---|---|
| **Subtasks (done/total)** | Add, complete (click the circle), open, set due date and priority. Subtasks can have their own subtasks. |
| **Checklists** | Several named checklists per task, each with a progress bar. Tick items, rename, delete. Finishing all items of a checklist is an automation trigger. |
| **Dependencies** | **＋ Waiting on**: pick tasks this one depends on. The task shows ⛔ in lists and "Waiting on N task(s)" while any blocker isn't done. *Blocking →* lists tasks waiting on this one. FollowUp refuses dependencies that would make a loop. |
| **Time entries** | The last 10 entries with date, note and duration; **Add time** for a manual entry; delete an entry. |
| **Email & calendar** | Linked email threads (click to open in the Inbox) and calendar events. **Email** opens Compose with the task title as subject. **Block time** puts the task on your calendar (see [Calendar](08-calendar.md#block-time-for-a-task)). |
| **Attachments** | **Attach files** copies files into FollowUp's data folder; click to open; delete. |
| **Comments / Activity** | Comments are written by you, by **ai** or by **automation**; `Ctrl+Enter` sends. *Activity* shows the history: created, renamed, status, priority, due date, moved, sprint, automation runs, repeats. |

## Completing and reopening

- Click the **round icon** in front of a task (anywhere: list, board, Home, subtasks) to **complete** it. It moves to the first *Done* status; clicking again reopens it into the first *Not started* status.
- Or pick a status in the panel, or drag the card on the Board.

## Recurring tasks

When a task with **Repeat** set is completed (moves into a *Done*-type status):

1. FollowUp creates a **new task** with the same title, description, priority, estimate, tags, custom fields, list and parent.
2. The new due date is the old due date + the interval. If there was no due date it uses the start date, or today. A start date shifts by the same interval.
3. Monthly repeats keep the day of the month, but clamp to the month's last day (31 Jan → 28/29 Feb).
4. The completed task stops repeating, so reopening and re-completing it doesn't create duplicates.
5. The new task's activity says *"recurring · Created from completed occurrence"*.

## Searching

- **`Ctrl+K`** searches task titles **and descriptions** (prefix matching, so `prop` finds *proposal*) and list names. It also offers commands. Up/down and Enter open the result.
- Every view has a **Search tasks…** box that filters the current location the same way.

## Bulk editing

In the **List** view, tick the checkboxes on the left (or the header box for all). A bar appears at the bottom:

- **Status**: each task gets the status with that name in its own space;
- **Priority**;
- **Due date**: pick one, or *Clear due date*;
- **Move** to another list;
- **Delete**.

## Behind the scenes

- **Code:** `src/main/services/tasks.ts` (create, update, delete, move, duplicate, checklists, comments, dependencies, search index). UI: `src/renderer/src/features/tasks/`.
- **Validation:** dates must be real `YYYY-MM-DD[THH:mm]` values (years 1900–2999) or empty. Anything else is refused with a clear message, so AI or automation mistakes can't store "next Tuesday" as a date.
- **Parents:** a task can't be its own parent or be moved under one of its own subtasks. Subtasks always live in their parent's list, and moving a task moves its whole subtree.
- **Domain events:** every change records **activity** and raises events in the same database transaction:
  - `task.created`, `task.status_changed`, `task.priority_changed`, `task.moved`, `task.tag_added`
  - `task.comment_added`, `task.checklist_completed`, `time.logged`

  [Automations](09-automations.md) listen to these.
- **Completion time:** `completed_at` is set when a task enters a *Done*-type status and cleared when it leaves. Dashboards, sprints and the weekly review use it.
- **Search:** a SQLite **FTS5** index (`tasks_fts`) holds each task's title and description (HTML removed). It's updated whenever either changes.
- **Ordering:** a task's `position` is a decimal number. Dropping a card between two others gives it the average of their positions, so nothing else needs renumbering.
- **Attachments:** files are copied to `attachments\<task id>\<attachment id>.<ext>`. Deleting the task (or its list, folder or space) deletes the files after the database change has committed.

## How it connects

- **Views and Home** show tasks.
- **Automations** react to task events and change tasks.
- **Email:** links to threads.
- **Calendar:** due dates on the calendar; *Block time*.
- **Planning:** time, sprints, goals and dashboards measure tasks.
- **AI:** reads, summarizes and creates tasks.

## Examples

- **"Waiting on the client":** create *Send final files*, then add a dependency on *Client approves design*. It shows ⛔ until approval is marked done.
- **Bills:**
  - Create *Pay electricity bill*, due on the 5th, **Repeat: Monthly**, with a reminder 1 hour before due.
  - Every time you tick it off, next month's bill appears.
- **Meeting notes to actions:**
  - Paste notes into a task's description.
  - Use ✨ **Suggest subtasks** to turn them into checkable steps.
