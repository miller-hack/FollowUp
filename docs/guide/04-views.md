# 4. Views: List, Board, Calendar, Gantt, Everything and Home

## What they're for

The same tasks can be seen four ways, and each answers a different question:

| View | Answers | Best for |
|---|---|---|
| **List** | *What is there, and what state is it in?* | Day-to-day work, editing many fields fast, bulk changes, custom fields |
| **Board** | *What stage is each piece of work at?* | Workflows (To Do → In Progress → Review → Done), stand-ups, pipelines |
| **Calendar** | *What happens when?* | Deadlines, content calendars, spreading work over days |
| **Gantt** | *How do the pieces fit over time, and what depends on what?* | Projects with start dates, durations and dependencies |

Open any space, folder, list or sprint from the sidebar (or **Everything**), then pick a tab at the top. **Each location remembers its own view**: the tab, filters, grouping, sorting and *Show* options.

## The filter bar (all views)

| Control | Effect |
|---|---|
| **Search tasks…** | Filters by words in titles and descriptions (prefix match). |
| **Status** | Show only the chosen statuses. In *Everything*, statuses with the same name in different spaces appear once. |
| **Priority** | Show only the chosen priorities. |
| **Tags** | Show tasks that have **any** of the chosen tags. |
| **Due** | Overdue · Due today · Next 7 days · No due date. |
| **Group** (List only) | Status · Priority · Due date. |
| **Sort** (List and Board) | Manual · Name · Due date · Priority · Created; ascending or descending. |
| **Show** (List, Calendar, Gantt) | *Closed tasks* (include *Done*-type tasks); *Subtasks* (List only: show subtasks whose parent is filtered out as their own rows). |

Active filters are highlighted. Click a filter's **✕** to clear it.

## List view

![List view](../images/list.png)

- **Groups:**
  - by **Status**: each status of the location, including empty open ones, so you can add to them;
  - by **Priority**;
  - by **Due date**: Overdue · Today · Next 7 days · Later · No due date.

  Click a group header to collapse it.
- **Columns:**
  - Name
  - List (shown when you're looking at more than one list)
  - Status, Due, Priority
  - Time (tracked / estimate, with a ▶ timer button)
  - Tags
  - one column per custom field of the space

  Click **Name**, **Due** or **Priority** in the header to sort by it; click again to reverse.
- **Edit in place:** every cell is editable; click it.
  - The round icon completes or reopens the task.
  - The status pill opens a status menu.
  - Hover a row to reveal the timer and the tag button.
- **Subtasks:**
  - The arrow ▸ in front of a task expands its subtasks underneath.
  - Small counters show subtasks done/total (☰ 1/3) and checklist items (☑ 2/3).
  - ⛔ means the task is waiting on unfinished dependencies.
- **New task** at the end of a group creates a task with that group's status, priority or due date.
- **Bulk edit:** tick rows to get the bulk bar (status, priority, due date, move, delete). See [Tasks → Bulk editing](03-tasks.md#bulk-editing).
- **Large lists:** only the rows on screen are drawn, so lists with thousands of tasks scroll smoothly.

## Board view

![Board view](../images/board.png)

- **One column per status.** The *Done* column is always shown on the Board, even if *Show closed tasks* is off.
- **Drag** a card to another column to change its status. With **Sort: Manual**, dropping a card onto another card in the same list places it right before that card.
- Cards show:
  - the list name
  - tags
  - priority flag and due date (coloured when overdue or due soon)
  - subtask and checklist counters
- **＋ Add task** under a column creates a task directly in that status.
- In *Everything* or a multi-space view, columns are merged **by status name**. Dropping a card into "Review" gives it the *Review* status **of its own space**; if that space has no status with that name, nothing happens.

## Calendar view (per location)

- **Month**, **Week** and **Day** layouts; **Today** jumps back.
- **Placement:** each task runs from its **start date** to its **due date**; a task with only one of them sits on that day.
  - Tasks without a time are in the all-day row.
  - Tasks with times sit in the time grid.
  - The colour is the status colour; the border is the priority colour.
- **Rescheduling:**
  - **Drag** a task to move it; start and due shift together.
  - **Resize** it to change the dates.
  - Dragging between the all-day row and the time grid converts it between a date and a date with a time.
- **Click an empty day** (or time slot) to Quick-add a task due then.

For events from real calendars, use the main **Calendar** page; see [Calendar](08-calendar.md).

## Gantt view

![Gantt view](../images/gantt.png)

- **Bars:** each task with dates is a bar from start to due. Subtasks are indented under their parent. Tasks without dates are listed at the bottom.
- **Moving and resizing:**
  - **Drag** a bar to move it.
  - **Drag its left or right edge** to change the start or due date. A start can't go past the due date, and vice versa.
- **Click** a bar (without dragging) to open the task. **Click an empty row** to give that task a start and due date on the clicked day.
- **Zoom:** Day / Week / Month. **Today** scrolls to the vertical today line. Weekends are shaded.
- **Dependency arrows** connect tasks to the tasks they're waiting on.

## Everything

**Everything** in the sidebar shows every task from every space in the same four views. It's handy for "what's overdue anywhere?" (*Due: Overdue*) or "all my urgent work" (*Priority: Urgent*).

## Home ("My Work")

Home is your daily starting point. It shows open tasks from all spaces:

| Card | Contains |
|---|---|
| **Overdue** | Due before today (only shown when there are some), oldest first |
| **Today** | Due today |
| **Next 7 days** | Due tomorrow through 7 days from now |
| **Unscheduled** | The 15 newest top-level tasks without a due date |
| **Recently updated** | The 10 tasks you changed most recently (any status) |

You can complete tasks, change their due date or open them right there. With AI set up, **Review my week** writes a short summary: what you finished, where your time went, what needs attention and a plan for next week.

## Behind the scenes

- **Code:** `src/renderer/src/features/views/` (`LocationPage`, `FilterBar`, `ListView`, `BoardView`, `CalendarView`, `GanttView`, `SprintHeader`); queries in `src/main/services/tasks.ts` (`queryTasks`, `getMyWork`).
- **Saved views:** a view's configuration is stored in the `settings` table under the key `view:<kind>:<id>` (for example `view:list:…`, or `everything`). It holds the tab, filter, grouping, sorting, subtask display and Gantt zoom.
- **Filtering:**
  - Filters run in SQL: location, status ids, priorities, tags (any), due-date window and full-text search.
  - *Done*-type tasks are excluded unless *Closed tasks* is on (the Board always includes them).
  - Grouping and sorting happen in the window.
- **Live updates:** after any change, the main process broadcasts `data-changed`, and every visible view refetches. That's why a change made by an automation, the AI or another panel appears everywhere at once.
- **Drag and drop:** Board drags call `moveTask` (new status plus a position between neighbours). Calendar and Gantt drags call `updateTask` with new dates. Both update the screen immediately ("optimistic"), then save.

## Examples

- **Morning routine:** open **Home**, clear *Overdue*, glance at *Today*, then switch to your main list's **Board**.
- **Planning a launch:** on the project list's **Gantt**:
  1. drag bars to lay out the schedule;
  2. add dependencies in the task panel so the arrows show the critical path;
  3. switch to **Calendar** to check no week is overloaded.
- **Weekly clean-up:** in **Everything → List**, set **Due: Overdue** and **Group: Priority**, select all and **bulk-move** the due dates.
