# 11. Slack and Microsoft Teams

## What it's for

- **Telling others (or your phone) what's happening:** send FollowUp notifications, automation messages or individual tasks to a Slack or Teams channel.
- **Capturing work from Slack:** react to a Slack message with an emoji (📝 by default) and it becomes a task in FollowUp.

## Connection types

| Type | Can post | Can create tasks from messages | Setup effort |
|---|---|---|---|
| **Slack (incoming webhook)** | ✓ one fixed channel | — | 2 minutes |
| **Slack (app with bot token)** | ✓ any channel the app is in | ✓ | 5 minutes |
| **Microsoft Teams (Workflows webhook)** | ✓ one channel (as a card) | — | 2 minutes |

## How to set it up

**Settings → Slack & Teams → ＋ Slack** or **＋ Microsoft Teams**. The dialog shows these steps, too.

### Slack: incoming webhook
1. Go to **api.slack.com/apps** → **Create New App** (from scratch) → **Incoming Webhooks** → turn it on → **Add New Webhook to Workspace** → pick the channel.
2. Copy the URL (`https://hooks.slack.com/services/…`) into FollowUp.
3. Give the connection a name, then **Send a test message** and save.

### Slack: app with a bot token
1. Go to **api.slack.com/apps** → **Create New App** → **OAuth & Permissions**. Add the bot scopes `chat:write`, `channels:read` and `channels:history` (plus `groups:read` and `groups:history` for private channels).
2. **Install to Workspace**, then copy the **Bot User OAuth Token** (`xoxb-…`).
3. In the Slack channel, type `/invite @your-app`.
4. In FollowUp, paste the token, click **Choose from list** and pick the channel (or paste its ID, `C0123…`). Test and save.

### Microsoft Teams: Workflows webhook
1. In Teams, open the channel → **⋯ → Workflows** → *"Post to a channel when a webhook request is received"*. Follow the steps and copy the URL it shows.
2. Paste it into FollowUp, then test and save.

## Options per connection

| Option | Effect |
|---|---|
| **Send my FollowUp notifications here** | Every notification: due dates, reminders, the daily summary and automation *notify* actions. It's sent as a message too. Great for getting them on your phone via the Slack or Teams app. |
| **Create tasks from messages with a reaction** *(Slack app only)* | Choose the **reaction** (emoji name, default `memo` = 📝) and the **list**. Any message in the watched channel that gets that reaction becomes a task: the title is its first line, and the description has the full text and an **Open in Slack** link. |

The connection card shows the channel or host, when it was last used and the last error. It has buttons to **send a test message**, **check the channel for new tasks now** (Slack app with a watched channel), **edit** and **remove**.

## Using connections

- **From a task:** the **Share** icon in the task panel header → choose a connection. It posts the task's title with its status, due date and list.
- **From automations:** the action **Post to Slack / Teams**, with variables such as `✅ {{task.title}} is done`. See [Automations](09-automations.md).
- **Notifications:** with mirroring on, everything you'd see in the notification center is posted too.

## Behind the scenes

- **Code:** `src/main/services/integrations.ts`; UI in `src/renderer/src/features/settings/Integrations.tsx`.
- **Secrets:**
  - Webhook URLs and bot tokens are **encrypted** (Windows DPAPI) and never sent to the window, which only sees the host or channel.
  - Webhooks must use `https://`, and Slack webhooks must be on `hooks.slack.com`.
- **Sending:**
  - Messages go through the background **job queue** (`integration_post`, 4 attempts with backoff), so a message written while offline is delivered later.
  - Permanent problems aren't retried pointlessly, for example a revoked webhook, an uninstalled app or a missing channel. They show as a plain-English error on the card (e.g. *"The app is not in that channel. In Slack, type /invite @your-app in the channel."*).
  - Slack messages use Slack's text format; Teams messages are sent as an Adaptive Card with a bold title.
- **Reaction → task (polling):**
  - A desktop app can't receive Slack's push events (it has no public web address), so FollowUp **polls** the watched channel every **2 minutes** while it runs. It looks at messages from the last **7 days**.
  - Each Slack message becomes a task **only once**: it's remembered in `slack_imported` (kept 30 days, longer than the 7-day window).
  - The task's source is recorded as *slack*.

## How it connects

| Feature | Connection |
|---|---|
| [Notifications](05-planning.md#reminders-and-notifications) | Mirroring |
| [Automations](09-automations.md) | *Post to Slack / Teams* action; Slack tasks can trigger *A task is created* rules |
| [Tasks](03-tasks.md) | Share a task; tasks created from reactions |

## Examples

- **Personal alerts on your phone:** a Slack webhook to a private channel `#me` with **Send my FollowUp notifications here**. Your due-date and reminder alerts now reach your phone through the Slack app.
- **Team updates:** an automation *Status changes to Done* (scoped to the project list) → *Post to Teams "✅ {{task.title}} done"*.
- **Slack triage:** a Slack app watching `#requests` with reaction `memo` → list *Inbox*. Teammates' requests become tasks with one emoji click. Add an automation *A task is created* (in *Inbox*) → *Set due date in 2 days*.
