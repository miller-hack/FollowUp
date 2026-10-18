# 8. Calendar

## What it's for

Seeing your **time** (meetings and events) and your **deadlines** (task due dates) together, so you can tell whether the plan fits into the week. Events you add in FollowUp sync to your real calendars, and changes made there come back.

![Calendar](../images/calendar.png)

## Calendars

| Calendar | Where it comes from |
|---|---|
| **My calendar** | Built in, stored only in FollowUp. Always available, even offline. |
| **Google Calendar** | Added automatically by **Settings → Accounts → Sign in with Google** (all your Google calendars). |
| **CalDAV calendars** | **Settings → Accounts → Calendar (CalDAV)**: iCloud (`https://caldav.icloud.com`), Fastmail, Zoho, Nextcloud, or any CalDAV server. You need the server URL, your username and an app password. **Test connection** reports how many calendars were found. |

On the Calendar page, the left column lists every calendar:
- tick or untick a calendar to show or hide it;
- click its dot to change its colour;
- **Task due dates** shows or hides tasks (from all spaces) on the calendar.

**Sync now** syncs every account immediately (calendars and mail); **Export .ics** saves a calendar file.

> Microsoft (Outlook / Microsoft 365) calendars aren't supported yet. Microsoft doesn't offer CalDAV, and the Microsoft Graph integration is on the roadmap.

## Working with events

- **Month / Week / Day** views; ‹ › and **Today** to navigate. The week starts on your chosen day (**Settings → Appearance**).
- **New event** opens a one-hour event starting at the next full hour, or **drag across** a time range (or days) to create an event there.
- **The event dialog:**
  - title and **All day**;
  - start and end;
  - which calendar;
  - location and notes;
  - **Delete**.
- **Drag** an event to move it; **drag its bottom edge** to change its length.
- **Recurring events** from a server show every occurrence. You can change their title, location and notes, but their **times** can only be changed in the calendar they came from. Deleting one asks whether to delete the **whole series**.
- **Read-only calendars** (for example, shared calendars you can't edit) can't be changed.

### Task due dates on the calendar
Tasks appear as dashed, all-day or timed entries on their due date. **Click** one to open the task; **drag** it to a new day or time to change its due date.

### Block time for a task
In the task panel, **Email & calendar → Block time** creates an event on your first writable calendar:

- **When:** on the task's due date (or its start date, or today). It starts at the due time, or at **09:00** when the date has no time.
- **How long:** the task's **time estimate**, or 60 minutes if there's no estimate.
- **Linked:** the event appears in the task under *Email & calendar*.

## Export (.ics)
**Export .ics** writes one iCalendar file you can import into other apps or share. It contains every event from 90 days ago to a year ahead (recurring events expanded into occurrences), plus **open tasks with due dates** as "Due: …" entries.

## Behind the scenes

- **Code:** `src/main/services/calendar.ts` (events, CalDAV sync, recurrence, .ics export); UI in `src/renderer/src/features/calendar/CalendarPage.tsx`. CalDAV uses *tsdav* and iCalendar parsing uses *ical.js*.
- **Storage:**
  - Events live in `calendar_events`, including the original iCalendar text (`raw`).
  - Dates use the app format: `YYYY-MM-DD` for all-day events (the end date is the last day, inclusive) and `YYYY-MM-DDTHH:mm` local time otherwise.
- **Sync (`syncCalDav`):** runs every **15 minutes**, on **Sync now**, and shortly after you change an event. For each server calendar it:
  1. **Pushes your local changes first:**
     - each new, edited or deleted event is uploaded on its own;
     - an event the server refuses stays marked *dirty* and is retried next time (the account card shows "Couldn't upload N event(s) (will retry)");
     - other events still sync.
  2. **Pulls** the server's events from 90 days back to 366 days ahead, skipping calendars whose change tag (*ctag*) hasn't changed.
  3. **On a conflict, the server wins:**
     - if an event changed on the server while you edited it locally (HTTP 412), the server version is kept;
     - events deleted on the server are removed here.
- **Recurring events** are stored once and expanded into occurrences when shown. Exceptions (moved or cancelled instances) are respected, and expansion is bounded so a bad rule can't freeze the app.
- **Google Calendar** uses Google's CalDAV endpoint with an OAuth access token. iCloud and others use Basic authentication with an app password, over HTTPS.

## How it connects

| Feature | Connection |
|---|---|
| [Tasks](03-tasks.md) | Due dates shown and draggable; *Block time*; linked events in the task panel |
| [Automations](09-automations.md) | Trigger **A calendar event is about to start** (N minutes before), with `{{event.title}}` and `{{event.start}}` |
| [AI assistant](10-ai.md) | Tools `list_events` (read) and `create_event` (needs your approval); the weekly review looks at next week's calendar |
| [Email](06-email.md) | Sign in with Google adds Gmail and Google Calendar together |

## Examples

- **Plan the week:** on Monday open **Calendar → Week** with *Task due dates* on. Drag deadlines off overloaded days and **Block time** for the big tasks.
- **Meeting prep:** an automation *"A calendar event is about to start, 15 minutes before"* → *Send me a notification "Up next: {{event.title}}"*. With a Slack integration, add *Post to Slack "Starting soon: {{event.title}}"*.
- **Share your schedule:** **Export .ics** and send the file to a colleague, or import it into another calendar app.
