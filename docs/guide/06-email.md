# 6. Email

## What it's for

Most work arrives by email, and much of it stalls waiting for a reply. FollowUp puts your inbox next to your tasks so you can:

- turn an email into a task in one click;
- see a task's email history inside the task;
- start an automatic follow-up when you're waiting on someone;
- let rules and AI sort and act on new mail.

It's a focused email client, not a full replacement for Outlook or Gmail. It syncs your **Inbox** and **Sent** folders, which is where follow-up work happens.

![Inbox](../images/inbox.png)

## Connecting an account

Go to **Settings → Accounts** and click **Add email account**. You only type your **email address**: FollowUp works out the rest.

| You'll be asked for | When |
|---|---|
| **Sign in with Google** (recommended) | Gmail and **Google Workspace** addresses, including company and university domains whose mail is run by Google. Also adds **Google Calendar**. |
| **Sign in with Microsoft** | Outlook.com, Hotmail, Live and **Microsoft 365** addresses |
| An **app password** | Gmail/Workspace (if you prefer it to sign-in), iCloud, Yahoo, Zoho, Fastmail. The dialog says where to create it. |
| Your **mailbox password** | Your company's own mail hosting (for example cPanel or Plesk): the password you use for webmail |

**Calendar (CalDAV)** adds a calendar only; see [Calendar](08-calendar.md).

### Adding an account step by step
1. Click **Add email account** and type your **email address**, then your name (shown to recipients).
   - The address must be complete, with the `@` (for example `name@company.com`); FollowUp points out a missing one.
2. FollowUp shows what it found, for example *Google Workspace · recognised from the domain's mail servers* or *Mail server mail.company.com*.
3. Either click **Sign in with Google/Microsoft**, or enter the password the dialog asks for.
4. Optional, under **Show server settings**:
   - IMAP and SMTP server, port and security (SSL/TLS or STARTTLS), already filled in;
   - username: the full email address unless your provider says otherwise (it can't contain spaces);
   - how much history to import: the last **7, 30 (default), 90 or 365 days**.
5. Click **Add account**. FollowUp first tests receiving (IMAP) and sending (SMTP). If either fails, it explains why in plain English and **doesn't add the account** until both work. **Add anyway** exists for servers that are only reachable from the office network.

**Behind the scenes: how the settings are found** (in order, each step limited to a few seconds):
1. Well-known domains: gmail.com, outlook.com, hotmail.com, yahoo.com, icloud.com, zoho.com, fastmail.com and similar.
2. The domain's **MX records** (where its mail is delivered). These reveal Google Workspace, Microsoft 365, Zoho, Fastmail, iCloud and Yahoo behind a company domain.
3. Published settings: Thunderbird's public settings database (by domain, then by the mail host's domain), then the domain's own `autoconfig` file.
4. Common server names: `mail.<domain>` and `imap.<domain>` on port 993, with SMTP on 465 or 587. FollowUp only checks that the port answers; it never sends your password while searching.

Only the domain name leaves your PC during the search, never your address or password. If nothing is found, the server fields open so you can type them in.

> **Outlook.com and most Microsoft 365 accounts no longer allow passwords** over IMAP. Use *Sign in with Microsoft*.
> **Gmail and Google Workspace app passwords** need 2-Step Verification, and a Workspace administrator can turn them off. *Sign in with Google* avoids both.

### Sign in with Google or Microsoft
1. Click the button. Installers built with sign-in IDs (see [Building and releasing](../developer/building-and-releasing.md#built-in-sign-in)) go straight to step 2. Otherwise FollowUp shows a short guide the first time:
   - **Google:**
     1. In console.cloud.google.com, create a project.
     2. Enable the *Gmail API* and the *CalDAV API*.
     3. In *Google Auth Platform*, fill in *Branding*; under *Audience* choose External, keep it in Testing and add **every address that will sign in** as a *test user*.
     4. Under *Data access*, add the scopes `openid`, `userinfo.email`, `userinfo.profile`, `https://mail.google.com/` and `calendar`.
     5. Under *Clients*, create a client of type *Desktop app*, then paste its client ID and client secret.
   - **Microsoft:**
     1. In portal.azure.com → *Microsoft Entra ID* → *App registrations* → *New registration*, choose "any organizational directory and personal Microsoft accounts".
     2. Set the redirect URI to *Public client/native* `http://localhost`, and under *Authentication* allow public client flows.
     3. Paste the application (client) ID.
2. Your **own browser** opens the provider's sign-in page; FollowUp never shows a login window of its own. Approve access.
3. FollowUp adds the mail account (and, for Google, a Google Calendar account) and starts syncing.

When a sign-in expires or is revoked, the account card shows **Sign in again**. Signing in again with the same address updates the existing accounts; it also converts an app-password account to sign-in.

> **"Error 403: access_denied" from Google** means your address isn't on the Google project's *Test users* list. Whoever set up the sign-in adds it under Google Auth Platform → Audience → Test users. **"Need admin approval" from Microsoft** means your organisation's IT administrator has to approve FollowUp.

> Google keeps apps in "Testing" mode for personal use. In that mode a sign-in expires after **7 days** unless the app is verified by Google. Use an app password if that's a nuisance.

### The account card
Each account shows its address and when it last synced (or the last error). It also has **Sync now** and **Remove**. Removing an account deletes its synced mail and attachments from FollowUp, but **not** from the server.

## How syncing works

- **What:** **every folder** on the server: Inbox, Drafts, Sent, Archive (Gmail: All Mail), Spam, Trash, and your own folders. Their roles come from the server's standard folder flags, or from their usual names in any language.
- **Each message is stored once**, even when it's in several folders (Gmail labels). FollowUp records every folder it's in. A message that is already known is never downloaded again; only its new place is noted.
- **First sync of a folder:** imports the last *N* days (your choice; at most the 500 newest messages per folder) **quietly**. Old mail doesn't fire automations.
- **Afterwards:**
  - FollowUp checks for new mail every **1, 2 (default), 5, 15 or 30 minutes** (**Settings → Email**), and whenever you click ⟳ in the Inbox;
  - only new messages are downloaded;
  - each new incoming message raises an **"email received"** event.
- **Moved or deleted elsewhere** (on your phone or webmail): the next sync notices. A message that is in no folder any more is removed from FollowUp too.
- **Read and unread state** syncs both ways:
  - opening an unread thread marks it read after a moment, here and on the server;
  - **Mark unread** reverses it;
  - mail read on your phone shows as read here at the next sync.
- **Threads:** messages are grouped by the standard reply headers (`Message-ID`, `In-Reply-To`, `References`). When those are missing, a reply ("Re: …") joins a recent thread with the same subject and a shared participant.
- **Robustness:** a message that can't be read is skipped and counted on the account card ("Skipped 1 message…"); it stays on the server. It never blocks the rest of the mailbox.

## Reading mail

- **The folder list** (left; drag its edge to resize):
  - **Inbox** (not Done), **Follow-up** (see [Follow-up](07-follow-ups.md)) and **Clients** (see [Clients](15-clients.md));
  - **Mail:** **Drafts**, **Sent**, **Archive**, **Spam** and **Trash** (when your server has them), FollowUp's **Done**, and **All mail** (everything except Spam and Trash);
  - **Folders:** your own server folders, nested as on the server;
  - an account filter appears when you have several accounts.
- **Search** looks through subjects, senders and message text.
- **Thread list:**
  - an unread dot, people, message count, 📎 for attachments, date, subject and preview;
  - chips for the AI category, the client company and its stage, "Reply needed" / "Waiting on them", and a linked task.
- **Widths:** the folder list, the email list and the reading pane are resizable; drag their edges. FollowUp remembers the widths.
- **AI categories:** with AI triage, chips at the top filter by category (*Needs action, Needs reply, FYI, Newsletter, Notification, Likely spam*). See [AI](10-ai.md#inbox-triage).
- **Messages:**
  - The last message and any unread ones are expanded; click a header to expand others.
  - Your own messages have an accent border.

### Reading safely
Email is the most common way attacks arrive, so FollowUp is strict:

- **Scripts, forms, embedded frames and event handlers are removed**, and the message is shown in a **sandboxed** frame that can't run code or navigate.
- **Remote images are blocked** by default, because they can tell the sender that (and when) you opened the email. Click **Show images** for one message, or turn on **Settings → Email → Load remote images**.
- **Links** open in your normal browser.
- **Pictures inside emails** (logos, signatures) are stored once per account as files, and shown from your disk.
- **Attachments:**
  - Click to open; files are saved with Windows' "downloaded from the internet" mark (Mark of the Web), so Windows and Office apply their usual protections.
  - **Programs, scripts, shortcuts, installers and disk images** (`.exe`, `.js`, `.lnk`, `.msi`, `.iso`, …) are **never opened** by FollowUp. You get a warning and **Show in folder** instead.
  - Attachments over 10 MB are listed but not saved by FollowUp; open those in your usual email app.

## Acting on a thread

| Button | What happens |
|---|---|
| **Reply / Reply all** | Opens Compose with the right recipients (yourself excluded), "Re:" subject and the last incoming message quoted. The reply is threaded correctly. |
| **Forward** | Opens Compose with the message text and its headers. |
| **Create task ▾** | Pick a list. Creates a task: title = subject without "Re:/Fwd:", description = sender and latest message. Task and thread are **linked**: the thread shows "Tasks: …" and the task shows the email. |
| **Done** | Moves the thread out of the Inbox **in FollowUp only** (the server isn't changed). A new incoming message brings it back. |
| **Archive** | Moves it to the server's Archive folder (Gmail: removes it from the Inbox, it stays in All Mail). |
| **Spam** / **Not spam** | Moves it to the server's Spam folder, or back to the Inbox. Spam never shows in Follow-up. |
| **Delete** / **Restore** | Moves it to Trash, or back to the Inbox. |
| **Delete forever** | In Spam or Trash only, after a confirmation: removed from the server and from FollowUp. |
| **Move ▾** | Any other folder on the server. |
| **Mark unread** | Marks it unread here and on the server. |
| **✨ AI** | Summarize, draft a reply, find tasks, sort this email. See [AI](10-ai.md). |

## Writing and sending

- **Compose:** the **Compose** button in the Inbox, `Ctrl+K → Compose email`, **Email** in a task, the AI assistant's drafts, or Reply/Forward.
- **Fields:**
  - **From:** choose an account.
  - **To / Cc:** addresses separated by commas; `Name <address>` works.
  - **Subject** and **Message:** plain text.
- **Formatting:** paragraphs and line breaks are kept, lines starting with `>` are shown as a quote, and links become clickable.
- **Templates:** **Insert template…** inserts a saved email template.
- **Save draft** keeps it in your server's Drafts folder, so it's on your phone too. Open it later from **Drafts** (or in its conversation) with **Edit draft**. Saving again replaces the earlier version; sending it removes the draft. **Discard** deletes it here and on the server.
- **Sending:** `Ctrl+Enter` or **Send**. Closing a draft you've written in asks before discarding it.
- **What happens after you press Send:**
  1. The email goes into an **outbox** and a background job sends it (up to 5 attempts, waiting 30 seconds, 2 minutes, 8 minutes and 32 minutes in between). While it's retrying, the thread shows *"Sending… (retrying: reason)"* with **Cancel**; if it finally fails, *"Couldn't send"* with **Retry**.
  2. As soon as the server accepts it, it's recorded as **sent**, so it can never be sent twice, even if a later step fails.
  3. A copy goes to your server's Sent folder when the provider doesn't do that itself (Gmail and Exchange do).
  4. It appears in the thread right away.
- **Your reply takes the conversation out of Follow-up's "Reply needed"** (a teammate's reply does too).

## Behind the scenes

- **Code:**
  - `src/main/services/mail/`: `accounts.ts` (accounts, sign-in, sync), `store.ts` (parsing, threading, storage, attachments, sanitising), `send.ts` (outbox and sending), `folders.ts` (every server folder, moves, deleting), `drafts.ts`, `followups.ts` (Follow-up), `detect.ts` (finding a provider's settings), `transport.ts` (IMAP/SMTP connections and readable errors);
  - `src/main/services/oauth.ts` (Google/Microsoft sign-in);
  - UI in `src/renderer/src/features/mail/`.
- **Connections:** IMAP is handled by *imapflow*, SMTP by *Nodemailer*, and parsing by *mailparser*.
  - Remote servers always use TLS: implicit TLS (ports 993/465), or STARTTLS, which is required on 143/587.
  - Sign-in accounts authenticate with OAuth access tokens (XOAUTH2).
- **Storage:**
  - Messages go in `mail_messages`: sanitised HTML and plain text. Where each message is on the server is in `mail_locations` (folder and UID), and the folders in `mail_folders`.
  - Threads go in `mail_threads`, with the *done* flag and the AI category.
  - Attachments are files under `mail\<account>\…` (`mail_attachments`).
  - Search uses the `mail_fts` full-text index.
- **Secrets:**
  - Passwords and refresh tokens are encrypted with Windows DPAPI.
  - Access tokens are kept only in memory and refreshed when needed.
  - The window never receives any secret.
- **Background jobs:**
  - `account_sync`: a sync;
  - `mail_send`: sending, 5 attempts;
  - `mail_flags`: pushing read/unread to the server;
  - `mail_move`, `mail_delete`, `draft_delete`: moves and deletions on the server (the screen changes at once; the server follows).
- **After each sync:**
  - each new incoming message in the Inbox raises a **`mail.received`** event for automations and AI triage;
  - the Follow-up state of every conversation that changed is recomputed.
- **Automated mail** (auto-replies, mailing lists, newsletters, bounces and `no-reply` senders, recognised from standard headers) is flagged. Automation rules never auto-reply to such mail.

## How it connects

| Feature | Connection |
|---|---|
| [Tasks](03-tasks.md) | Create task from email; linked emails in the task panel; "Email" from a task |
| [Follow-up](07-follow-ups.md) | Which conversations wait for a reply from you, or from them; follow-up drafts |
| [Clients](15-clients.md) | Conversations show the client company; client history lists the emails |
| [Automations](09-automations.md) | Triggers *email arrives*, *email needs follow-up*, *sent email gets no reply*, *AI classifies an email*; email conditions; actions *send email*, *reply*, *create task from email*, *mark read* |
| [AI](10-ai.md) | Triage, summaries, reply drafts, extracting to-dos; the assistant can search and read threads and open drafts |
| [Calendar](08-calendar.md) | *Sign in with Google* also adds Google Calendar |

## Examples

- **Client asks for something:** open the email → **Create task ▾ → Clients**, set a due date in the panel, then reply *"On it — you'll have it Friday."* The task links to the thread for context.
- **Proposal sent, waiting for an answer:** do nothing. If they haven't answered after 30 working hours, the email shows up in **Follow-up → Waiting on them** with a nudge ready to send.
- **Inbox zero:** reply or create tasks for what matters, then press **Done** on each thread. The Inbox only shows what still needs you.
