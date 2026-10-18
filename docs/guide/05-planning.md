# 5. Planning and tracking: time, sprints, goals, dashboards, reminders and notifications

## Time tracking

### What it's for
Knowing where your hours go: billing clients, checking estimates, or just being honest with yourself in the weekly review.

### How to use it
- **Timer:** press ▶ **Start** in the task panel (or ▶ in a List row). The sidebar shows a timer bar with the elapsed time; the window title and the tray show it too.
  - Press ■ to stop.
  - **Only one timer runs at a time.** Starting another stops the first.
  - Timers shorter than **5 seconds** are discarded as accidental clicks.
- **Manual entries:** **Add time** in the task panel, or **Add entry** on the Time tracking page. Set the task, date, start time, duration (`1h 30m`, `45m`, `2`) and an optional note.
- **Time tracking page:**
  - a **weekly timesheet**: one row per task, one column per day, with totals per day and for the week;
  - **‹ ›** moves between weeks, and **This week** jumps back;
  - under it, the list of **entries**, where you can edit a duration in place or delete an entry.
- **Export CSV:** exports the shown week. Columns: Start, End, Hours, Task, List, Space, Note, Billable. The file is UTF-8 with a byte-order mark, so Excel opens accents correctly. (*Billable* is stored per entry for future invoicing features; there is no switch for it on screen yet.)
- **Estimate vs actual:** the task panel and List view show `tracked / estimate`; it turns amber when tracked time exceeds the estimate.

### Behind the scenes
- **Storage:** entries live in `time_entries` with UTC start and end times and a duration in seconds. A running timer is the entry with no end. Code: `src/main/services/time.ts`.
- **Event:** stopping a timer or adding or editing an entry raises `time.logged`. The automation trigger **"Tracked time exceeds the estimate"** uses it, and fires once per task per estimate value.
- **Tray:** the tray menu shows the running timer with *Open timed task* and *Stop timer*.

## Sprints

### What they're for
Time-boxed iterations (typically 1–2 weeks): commit to a set of tasks, watch the burndown, and carry unfinished work into the next sprint.

### How to use it
1. **Create:** space **⋯ → New sprint**.
   - The first sprint is named *Sprint 1* and starts today for 2 weeks.
   - Each new sprint starts the day after the previous one ends and has the same length.
   - Sprints appear in the sidebar under their space until they're completed.
2. **Add tasks:** set **Sprint** in the task panel. Alternatively, open the sprint and create tasks there, and they join it automatically. A task can only be in a sprint of its own space.
3. **Open the sprint** from the sidebar. It works like any location (List, Board, Calendar, Gantt), with a **sprint header**:
   - status (*Planned / Active / Closed*);
   - editable start and end dates, and days left (or days over);
   - a progress bar (*done/total*) and the total estimate;
   - the **Burndown** chart.
4. **Start sprint:** one sprint per space can be active. Starting one makes any other active sprint in that space *planned* again.
5. **Complete sprint:**
   - it's marked *closed*;
   - its **unfinished tasks move to the next planned sprint** in the space (one is created if none exists);
   - that next sprint becomes active.

   A message tells you how many tasks moved.

**Burndown:** for each day of the sprint, *remaining* = the sprint's tasks not completed by the end of that day. The *ideal* line falls evenly from the total to zero. Future days have no remaining value yet.

### Behind the scenes
Code: `src/main/services/planning.ts` (`createSprint`, `updateSprint`, `completeSprint`, `getSprintStats`). Sprints belong to a space. Moving a task to another space clears its sprint. Deleting a sprint keeps its tasks.

## Goals and key results

### What they're for
Connecting day-to-day tasks to outcomes ("Launch the new website", "Grow Q4 revenue") and seeing progress at a glance.

### How to use it
1. **Goals → New goal:** name, description, colour and due date.
2. **Add key results**, each of one type:

| Type | You enter | Progress |
|---|---|---|
| **Number** | start, target, current, unit | (current − start) ÷ (target − start), clamped to 0–100 % |
| **Percentage** | current % | current ÷ 100 |
| **Currency** | target, current, symbol (default `$`) | like Number |
| **True / false** | a done toggle | 0 % or 100 % |
| **Tasks** | linked tasks (**Link task**) | done tasks ÷ linked tasks |

3. The **goal's progress** is the average of its key results. Update numbers in place; *Tasks* key results update by themselves as tasks are completed.

### Behind the scenes
Tables `goals`, `key_results` and `key_result_tasks`; formulas in `krProgress()` in `planning.ts`. The *Goals* dashboard widget and the AI tool `list_goals` read the same data.

## Dashboards

### What they're for
A live overview of workload, throughput and time, for one location or everything.

![Dashboard](../images/dashboard.png)

### How to use it
FollowUp creates an **Overview** dashboard the first time you open Dashboards. **＋** next to the tabs adds more dashboards. **Add widget** offers:

| Widget | Shows | Options |
|---|---|---|
| **Number** | One headline count | Metric: open tasks, overdue, due today, completed in the last 7 days, time tracked in the last 7 days |
| **Tasks by status** | Count per status (merged by name) | Location |
| **Tasks by priority** | Open tasks per priority | Location |
| **Completed over time** | Tasks completed per day | Location; period (e.g. 14 days) |
| **Time by list** / **Time by tag** | Tracked time | Location; period |
| **Task list** | Up to 15 tasks | Overdue, due soon or recently completed; location |
| **Goals** | Every goal with its progress | — |
| **Sprint burndown** | Remaining vs ideal | A specific sprint, or the current active one |

Each widget can be **edited** (title, location, options), **resized** (1–4 columns wide), **removed**, and **dragged** by its handle to reorder. Every chart is also readable as a labelled list. When there are more than 8 categories, the rest are folded into "Other".

### Behind the scenes
Code: `src/main/services/dashboards.ts`. Widget settings are JSON in `dashboard_widgets.config`; each widget computes its numbers in SQL when shown, so they're always current. Colours come from a fixed, colour-blind-safe palette (status and priority colours where they exist).

## Reminders and notifications

### What they're for
Making sure you hear about the things that matter, at the right moment, even when the window is closed.

### Kinds of notifications

| Kind | When |
|---|---|
| **Reminder** | At the time you set (task reminders, standalone reminders, reminders created by automations or the AI). |
| **Due** | For a task with a **due time**: at the due time minus the lead you chose (at the due time, or 5, 15, 30 or 60 minutes before). For a task due on a **day without a time**: at the time of day you chose (default 09:00). Each task and due date notifies once; if you change the due date, it can notify again. |
| **Daily summary** | Once a day at your chosen time (default 08:30): "N due today · M overdue". Skipped when there's nothing to report. |
| **Automation** | Whatever a rule's *Send me a notification* action says. |

### How to use it
- **🔔 Notification center** (sidebar):
  - the **Notifications** tab lists recent ones (click to open the task); *Read all* and *Clear all* (the bin icon) tidy it up;
  - the **Reminders** tab lists upcoming reminders. Type in **Remind me to…** and pick a time to add a standalone reminder, or tick to mark one done.
- **Windows notifications** (installed app): appear in the corner and in the Windows notification center. Clicking one opens the task.
- **Settings → Notifications:** turn due-date notifications on or off, the lead time, the day time, and the daily summary time.
- **Slack / Teams:** an integration can mirror every notification to a channel. See [Slack & Teams](11-integrations.md).

### Behind the scenes
- **When:** every 30 seconds, `collectDue()` in `src/main/services/notify.ts` checks:
  - reminders whose time has passed;
  - open tasks due between yesterday and tomorrow;
  - whether the daily summary is due.
- **Once only:** each notice is recorded once. Reminders get `notified_at`; due notices and summaries get a key in `notify_log`, such as `due:<task>:<due date>` and `digest:<date>`.
- **Old due times:** a timed due notification stops being sent once the task has been due for 12 hours, so you aren't flooded after the PC was off.
- **Storage:** notifications are stored in `notifications`. Maintenance deletes read ones after 90 days and keeps at most 1,000.

## How it connects

| Feature | Connection |
|---|---|
| Time | <ul><li>Triggers *time over estimate*.</li><li>Feeds dashboards, the weekly review and the AI tool `time_report`.</li></ul> |
| Sprints | <ul><li>A location you can open and scope automations to.</li><li>Shown by the *Sprint burndown* widget.</li></ul> |
| Goals | <ul><li>*Tasks* key results move as tasks are completed.</li><li>Shown in the *Goals* widget and readable by the AI.</li></ul> |
| Notifications | <ul><li>Created by reminders, due dates, the daily summary and automations.</li><li>Mirrored to Slack and Teams.</li></ul> |

## Examples

- **Freelance billing:** start the timer on each client task. On Friday, open **Time tracking**, check the week and **Export CSV** for your invoice spreadsheet.
- **Two-week sprints:**
  1. Create *Sprint 1* in your *Product* space and pull in tasks.
  2. Start it; check the burndown at stand-up.
  3. On the last day, **Complete sprint**: leftovers roll into *Sprint 2*, which becomes active.
- **Quarterly goal:** *Grow Q4 revenue* with a Currency key result (target 50,000) and a Tasks key result linked to your five sales tasks. Add a *Goals* widget to your dashboard.
- **Never miss a deadline:** set the due-time lead to 30 minutes, and the day-time notice to 08:00 so date-only deadlines show up at the start of your day.
