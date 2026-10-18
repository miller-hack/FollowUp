# 2. Workspace: spaces, folders, lists, statuses, custom fields and tags

## What it's for

The workspace is the skeleton your tasks hang on. A good structure makes filters, views, automations, dashboards and the AI assistant all more useful, because they all work by **location**.

```
Space                    e.g. Work, Personal, Clients            (has statuses, custom fields, sprints)
 ├─ Folder (optional)    e.g. Projects, Marketing
 │   └─ List             e.g. Website Launch
 │       └─ Task
 │           └─ Subtask  (subtasks can have subtasks)
 └─ List                 lists can also sit directly in a space
```

| Level | Use it for | Typical examples |
|---|---|---|
| **Space** | An area of your life or a department; anything that needs **its own workflow** (statuses) or **its own custom fields** | Work, Personal, Clients, Content |
| **Folder** | Grouping several related lists | Projects, Q4 campaigns, Customers A–M |
| **List** | One project, stream of work or backlog | Website Launch, Bugs, Blog posts, Errands |
| **Sprint** | A time box (usually 1–2 weeks) of tasks from one space | Sprint 12 |

## How to use it

### Creating and organising

Hover any row in the sidebar and click **⋯** for its menu.

| Where | Menu items |
|---|---|
| **Spaces ＋** | Creates *New Space*. Type a name, then Enter. |
| Space **⋯** | New list · New sprint · New folder · Rename · Color · **Statuses** · **Custom fields** · Delete space |
| Folder **⋯** | New list · Rename · Delete |
| List **⋯** | Rename · Color · **Move to…** (another space or folder) · Delete |
| Sprint **⋯** | Rename · Delete sprint (its tasks are kept) |

- Click a space, folder, list or sprint to open its tasks. A space or folder shows all the tasks of the lists inside it.
- The arrow next to a space or folder collapses it. FollowUp remembers what you collapsed.
- **Deleting** a space, folder or list deletes **all its tasks, subtasks and their attachment files**. You're asked to confirm first, and the daily backup is your safety net.

### Statuses

Each **space** has its own ordered list of statuses. New spaces start with:

| Status | Type | Colour |
|---|---|---|
| To Do | Not started (`open`) | grey |
| In Progress | Active (`active`) | blue |
| Review | Active (`active`) | purple |
| Done | Done (`done`) | green |

Open **space ⋯ → Statuses** to:
- rename statuses and change their colours;
- change a status's **type**;
- reorder them with ↑ ↓;
- add (**＋ Add status**) or remove statuses.

A space must keep at least one status, and at least one of type **Done**.

**The type matters more than the name:**
- **Done** means finished:
  - the task gets a completion time;
  - it's hidden from views unless you choose *Show → Closed tasks*;
  - it counts as complete in subtask counters, goals, sprints, burndowns and dashboards;
  - it no longer triggers due-date notifications or overdue rules;
  - if the task repeats, its next occurrence is created.
- **Not started** and **Active** are both "open". The difference is only for you (and for the first-status fallback described below).

### Custom fields

Open **space ⋯ → Custom fields** to add fields that every task in that space gets. They appear in the task panel and as columns in the List view.

| Type | Stores | Shown as |
|---|---|---|
| Text | any text | text |
| Number | a number | number |
| Money | an amount | US-dollar formatted amount |
| Date | a date | "Today", "Mon", "Oct 3" |
| Dropdown | one option (each option has a colour) | coloured label |
| Labels (multi) | several options | coloured labels |
| Checkbox | yes / no | ☑ / ☐ |
| URL | a link | clickable link |
| Email | an address | text |
| Phone | a number | text |
| Rating | 0–5 | ★★★ |
| Progress | 0–100 | bar + % |

For dropdown and labels fields you can add, recolour and remove options in the same dialog. Removing a field deletes its values from every task.

### Tags

Tags work **across all spaces** (unlike custom fields). Use them for cross-cutting themes such as `client`, `waiting`, `quick-win` or `design`.

- **Add tags:** use the tag icon in the task panel, the list row or Quick add. Typing a new name creates the tag; names are unique regardless of case, and new tags get the next colour from a palette.
- **Manage tags:** **Settings → Tags** lets you rename, recolour and delete them.
- **From Quick add:** with AI enabled, `#hashtags` in Quick add become tags, and missing ones are created.

## Behind the scenes

- **Tables:**
  - `spaces`, `folders`, `lists`, `statuses`
  - `custom_fields`, plus `custom_field_values` (one row per task and field; the value is stored as JSON)
  - `tags`, plus `task_tags`

  Every row has a UUID id. Order is a `position` number; new items go to the end. Code: `src/main/services/hierarchy.ts`, `src/main/services/meta.ts`.
- **Status changes in the editor** (`saveStatuses`):
  - statuses you keep keep their id;
  - tasks on a **removed** status move to the first remaining status **of the same type** (or the first status if there is none).
- **Moving tasks or lists between spaces** (`remapStatuses`). Each task's status is mapped to the target space's status:
  1. one with the **same name** (case-insensitive);
  2. otherwise one with the **same type**;
  3. otherwise the first status.

  Moving a task to another space also removes it from its sprint, because sprints belong to a space.
- **Status names connect spaces.** Because of the mapping above:
  - the Board in *Everything* merges columns with the same name across spaces;
  - automations match statuses **by name** ("status changes to Review" works in every space that has a *Review* status);
  - the AI assistant changes status by name.

  Using the same status names everywhere makes all of this smoother.
- **Deleting** removes rows in one transaction (subtasks, checklists, comments and so on cascade through foreign keys). Afterwards the attachment files on disk are removed too.

## How it connects

| Feature | How the workspace matters |
|---|---|
| [Views](04-views.md) | Each location has its own saved view (List/Board/…, filters, grouping). |
| [Automations](09-automations.md) | Task rules can be **scoped** to a space, folder, list or sprint; conditions can test list, status, tag, sprint and custom fields. |
| [Dashboards](05-planning.md#dashboards) | Every widget can be limited to a location. |
| [Sprints](05-planning.md#sprints) | Created per space; show under it in the sidebar. |
| [AI assistant](10-ai.md) | Reads your structure (`list_workspace`) to choose where to create tasks. |

## Examples

- **Freelancer:**
  - Space *Clients* with one list per client and a dropdown field *Billing* (Hourly / Fixed).
  - Space *Admin* for invoices and taxes.
  - Tag `waiting` for anything blocked on a client.
- **Small team lead:**
  - Space *Product* with statuses Backlog → In Progress → Review → QA → Done (QA type *Active*).
  - Folders per quarter.
  - Sprints every two weeks.
  - Custom fields *Estimate (Number)* and *Area (Labels)*.
- **Personal life:** a space *Home* with lists *Bills* (recurring tasks), *Errands* and *Trips*, plus the tag `quick-win` for five-minute jobs.
