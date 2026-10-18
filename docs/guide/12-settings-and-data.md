# 12. Settings, data, backups and security

## Every setting

Open **Settings** (bottom of the sidebar).

| Section | Setting | Default | Effect |
|---|---|---|---|
| **Appearance** | Theme | System | Light, Dark, or follow Windows. |
| | Week starts on | Monday | Calendars, the timesheet and "Next week" quick picks. |
| **Accounts** | Sign in with Google / Microsoft, Email (app password), Calendar (CalDAV) | — | See [Email](06-email.md) and [Calendar](08-calendar.md). Each account has *Sync now* and *Remove*. |
| **Slack & Teams** | Connections | — | See [Slack & Teams](11-integrations.md). |
| **AI** | Provider, model, keys, thinking effort, automatic email sorting | Claude, Opus 5.5, Medium, sorting off | See [AI](10-ai.md). |
| **Email & follow-ups** | Check for new mail every | 2 minutes | 1, 2, 5, 15 or 30 minutes. |
| | Load remote images in emails | Off | Remote images can tell senders when you opened an email. |
| | Follow-ups that came due while this PC was off (more than a day) | Send them | *Send them* or *Skip them*. See [Follow-ups](07-follow-ups.md#behind-the-scenes). |
| **Notifications** | Notify when tasks are due | On | Lead time for timed due dates (at the time, or 5, 15, 30 or 60 min before) and the time of day for date-only due dates (09:00). |
| | Daily summary | On, 08:30 | "N due today · M overdue". |
| **Window & startup** | Keep running in the system tray when the window is closed | Asked the first time you close | Keeps reminders, sync, automations and follow-ups running. |
| | Start FollowUp when I sign in to Windows | Off | Starts hidden in the tray (installed app only). |
| **Updates** | Version, status, *Check for updates*, *Restart and update* | — | |
| | Download updates automatically | On | Checks 15 s after start and every 6 h. |
| | Update server | Built in: FollowUp's GitHub releases | Leave empty to use the built-in source. To use your own server instead, enter an `https://` folder containing `latest.yml` and the installer. See [Building and releasing](../developer/building-and-releasing.md#auto-update). |
| **Tags** | Rename, recolour, delete | — | Tags are shared by all spaces. |
| **Data & backups** | Data folder path + **Open folder** | `%APPDATA%\FollowUp` | |
| | **Back up now** · **Export JSON** · recent backups | daily automatic backup | See below. |
| **Keyboard shortcuts** | Reference list | — | See [Getting started](01-getting-started.md#keyboard-shortcuts). |

## Backups

- **Automatic:** once a day (at start-up and checked hourly), FollowUp writes a complete, consistent copy of the database to `backups\followup-YYYY-MM-DDTHH-MM-SS.db`. It uses SQLite's `VACUUM INTO`, so the copy is compact and safe even while the app runs.
- **Manual:** **Settings → Data & backups → Back up now**.
- **How many are kept:** up to **14**. The newest **3** are always kept; older ones are removed once all backups together exceed **2 GB**.
- **Before risky one-time conversions** (e.g. the 1.0 email-storage upgrade), FollowUp takes an extra backup regardless of age.
- **What a backup contains:** the database only (tasks, settings, mail text, everything). It doesn't include the attachment files in `attachments\` and `mail\`; copy the whole data folder if you want those too.

### Restoring a backup
1. **Quit** FollowUp completely (tray icon → **Quit FollowUp**).
2. Open `%APPDATA%\FollowUp`. Rename `followup.db` to keep it (e.g. `followup-broken.db`), and **delete** `followup.db-wal` and `followup.db-shm`.
3. Copy the backup you want from `backups\` to `%APPDATA%\FollowUp\followup.db`.
4. Start FollowUp.

## Export

| Export | Where | Contains |
|---|---|---|
| **JSON** | Settings → Data & backups → **Export JSON** | Everything you created: spaces, folders, lists, statuses, tasks, tags, custom fields and values, checklists, comments, attachment records, dependencies, activity, sprints, time entries, goals, dashboards, reminders, automations, email templates, sequences, your local calendar and its events, Slack/Teams connections **without** their secrets, and settings **without** secrets. Not included: passwords, keys and tokens; synced mail; synced calendars (those come back from their servers). |
| **CSV** | Time tracking → **Export CSV** | The shown week's time entries (Excel-friendly) |
| **.ics** | Calendar → **Export .ics** | Events (−90 to +366 days) and open tasks with due dates |

Import isn't built in yet. The JSON format is documented by its table names (see [Data model](../developer/data-model.md)), so it's easy to process with scripts.

## Maintenance (automatic)

Shortly after start-up and then daily, FollowUp tidies its database:

| What | Rule |
|---|---|
| Read notifications | Deleted after 90 days; at most 1,000 notifications kept |
| Notification log (which notices were already sent) | 120 days |
| Automation fire-once keys | 400 days |
| Background jobs | Finished: 7 days; failed: 30 days |
| AI usage records | 400 days |
| Slack "already imported" records | 30 days |
| Orphans | Activity of deleted tasks; search-index rows of deleted tasks or emails; image files no email uses any more |
| Invalid dates stored by very old versions | Cleared, with an entry in the task's activity |
| Free space | Unused database pages are returned to the disk (incremental auto-vacuum) |

## Moving to a new PC

1. On the old PC, **quit** FollowUp and copy the whole `%APPDATA%\FollowUp` folder (e.g. to a USB drive).
2. Install FollowUp on the new PC, **start it once and quit**, then replace its `%APPDATA%\FollowUp` with your copy.
3. Start FollowUp. Your tasks, settings and mail are there.
4. **Re-enter your secrets:** passwords, API keys and sign-ins are encrypted with Windows DPAPI for your old PC's user, so they can't be read on the new one.
   - Accounts show sign-in errors: use **Sign in again**, or edit the account and enter the app password.
   - Re-paste AI keys and Slack/Teams secrets.

## Starting fresh

Quit FollowUp and delete (or rename) `%APPDATA%\FollowUp`. The next start creates an empty database with the example workspace.

## Security and privacy model

| Area | How FollowUp protects you |
|---|---|
| **Data location** | Everything is local; no FollowUp server exists. No telemetry or analytics. |
| **Secrets** | Passwords, OAuth refresh tokens, API keys and webhook URLs are encrypted with Windows DPAPI (tied to your Windows account). They never reach the window; OAuth access tokens live only in memory. |
| **The window** | The UI runs sandboxed with context isolation and no Node.js access. It can only call an allow-listed API, and every call is checked to come from FollowUp's own page. The window can't be navigated to other pages, and web links open in your browser. |
| **Email** | HTML is sanitised and shown in a sandboxed frame with a strict content policy: no scripts, no forms, remote images blocked by default. |
| **Attachments** | Saved with Mark of the Web. Programs, scripts, shortcuts and disk images are never launched; FollowUp offers *Show in folder* instead. |
| **Network** | Mail and calendars over TLS. Webhooks must be HTTPS. OAuth uses PKCE with a one-off local redirect in your own browser. Updates only come from HTTPS servers. |
| **AI** | Opt-in; only the items you use AI on are sent; local Ollama keeps everything on your PC or network; email and task text is treated as data, not instructions; writes need your approval; the assistant never sends email. |
| **Automations** | Never auto-reply to automated mail; at most one email per rule, recipient and day; chains stop at depth 5. |
| **Installer** | Per-user, with no admin rights. *Not yet code-signed*: compare the SHA-256 hash in the release notes. |

Found a security problem? See [SECURITY.md](../../SECURITY.md) for how to report it privately.

## Behind the scenes

Settings are one JSON document under the key `app` in the `settings` table. Missing values fall back to defaults, so new versions can add settings safely. Code: `src/main/services/meta.ts` (`DEFAULT_SETTINGS`, `getSettings`, `updateSettings`); backups and export in `src/main/services/files.ts` and `exporter.ts`; maintenance in `src/main/services/maintenance.ts`.
