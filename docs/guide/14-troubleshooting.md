# 14. Troubleshooting

FollowUp keeps no log file. Problems are shown where they happen:

- the **account card** (Settings → Accounts) shows sync and sign-in errors;
- the **Slack/Teams card** shows delivery errors;
- an email that's retrying or failed shows **in its thread**;
- **Automations → Run history** shows skipped and failed runs;
- a **follow-up's status** shows why it stopped.

## The app

**I closed FollowUp and can't find it / it won't reopen.**
Closing the window can keep FollowUp running in the background (you chose this the first time you closed it).
- **To reopen:** click **FollowUp** in the Start menu or on the desktop (this shows the existing window), or click the tray icon next to the clock (click **^** if it's hidden).
- **To exit completely:** right-click the tray icon → **Quit FollowUp**.
- **To change what closing does:** **Settings → Window & startup**.

**Windows says "Windows protected your PC" when installing.**
The installer isn't code-signed yet. Click **More info → Run anyway**. To be careful, compare the SHA-256 hash from the release notes (`Get-FileHash` in PowerShell).

**FollowUp shows up as "Electron" somewhere.**
That only happens for developer builds started with `npm run dev`. Install from the release installer. If an *Electron* Start-menu shortcut exists from development, you can delete it.

**Something on a screen shows "Something went wrong showing …".**
That area hit an error, but the rest of the app keeps working. Click **Try again**. If it repeats, please [report it](../../README.md#reporting-bugs-and-getting-help) with the message shown.

**The app feels slow or the data folder is big.**
- Large old mailboxes were the usual cause before 1.0; 1.0 converts them on first start.
- Check `%APPDATA%\FollowUp\backups`: old large backups are pruned automatically once they exceed 2 GB (the newest 3 are kept), and you can delete old ones by hand.
- Very large lists are fine in the List view. Board views with thousands of cards are slower.

## Email

**"Sign-in failed" when adding an account.**
- **Username:** it is almost always the **full email address** (`name@company.com`), not your name. FollowUp fills it in for you; spaces aren't allowed.
- **Which password:**
  - **Gmail / Google Workspace, iCloud, Yahoo, Zoho, Fastmail** need an **app password**, not your normal password. The dialog says where to create one.
  - **Your company's own mail hosting** (cPanel, Plesk, …) uses the **normal mailbox password**, the one you use for webmail.
  - **Outlook.com / Microsoft 365** mostly refuse passwords: use **Sign in with Microsoft**.
- For Gmail, **IMAP must be enabled**. App passwords need **2-Step Verification**, and a Workspace administrator can turn them off.

**"Server not found".**
The server name doesn't exist. Retype the email address so FollowUp detects the settings again. Many company and university addresses are run by Google or Microsoft (e.g. `@cloud.university.edu` → Gmail servers), so `mail.<domain>` doesn't exist for them.

**Google shows "Error 403: access_denied".**
The Google project behind *Sign in with Google* is in testing, and your address isn't on its **Test users** list. Whoever set up the sign-in adds it under Google Cloud → Google Auth Platform → Audience → Test users. Then try again.

**Microsoft shows "Need admin approval".**
Your organisation only lets approved apps read mail. Ask your IT administrator to approve *FollowUp*, or connect a different account.

**"Sign in again" on a Google account every week.**
A Google OAuth client in *Testing* mode issues sign-ins that expire after 7 days. Publish or verify your OAuth app in Google Cloud, or use an app password account instead.

**New mail doesn't appear.**
- FollowUp must be running; it syncs every *N* minutes (**Settings → Email**).
- Click ⟳ in the Inbox.
- Check the account card for an error.
- Only **INBOX** and **Sent** are synced; mail that your provider files into other folders won't show.

**"Skipped N messages that could not be read".**
Those messages are malformed or unusual. They stay on the server and the rest of the mailbox syncs normally. Read them in your provider's app.

**An email is stuck "Sending… (retrying: …)" or "Couldn't send".**
- The text after "retrying" is the server's reason (wrong password, recipient refused, offline, …).
- FollowUp retries 5 times over about 45 minutes. Fix the cause, then press **Retry**, or **Cancel** to drop it.

**An attachment won't open.**
- Programs and scripts are **intentionally** never opened: use **Show in folder** if you trust the file.
- Attachments over 10 MB aren't stored by FollowUp; open those in your usual email app.

## Follow-ups

**An email I expected isn't in Follow-up.**
- **Not long enough yet:** "Reply needed" waits 24 working hours, "Waiting on them" 30; non-working days don't count. Open the conversation: its panel says when it moves to Follow-up.
- **Someone on your side answered:** a reply from any connected mailbox, or from anyone at your company domain (Settings → Follow-up), counts.
- **It isn't a real conversation:** auto-replies, newsletters, mailing lists and no-reply senders are ignored, and AI-sorted newsletters or notifications don't need a reply.
- **Done, snoozed or dismissed:** Done conversations don't need a reply; snoozed or "No follow-up needed" ones come back later (open the conversation and click **Bring back**).
- **Too old:** only the last 14 days are looked at (Settings → Follow-up → Look back).

**Internal emails show up in Follow-up.**
Add your company's other domains in **Settings → Follow-up → Other company domains**.

**The follow-up draft is a template, not written by AI.**
AI isn't set up, or the request failed; the panel says why. See [AI](10-ai.md).

**My old follow-up sequences are gone.**
FollowUp 1.1 replaced automatic sequences with the Follow-up view. Sequences that were running stopped at the update, and nothing is sent automatically any more.

## Automations

**My automation didn't run.**
1. Is it **switched on**?
2. **Scope:** is the task inside the space, folder or list the rule is limited to?
3. **Conditions:** open the rule, pick the task or email under **Test** and click **Run test**. You'll see which check fails.
4. **Run history:** look for *skipped* (with the reason) or *failed* (with the error).
5. **Time-based rules:**
   - They fire once per task and due date, and only while FollowUp runs.
   - A schedule doesn't fire for a time before the rule existed.
   - If the PC was off all day, that day's schedule is skipped.
6. **Email rules:**
   - They don't fire for mail imported during an account's **first** sync.
   - *AI classifies* rules need automatic sorting on (Settings → AI).
7. **"Stopped: 5 automations already ran in a chain"** means loop protection kicked in. Simplify the rules that trigger each other.
8. **"Skipped: … is an automated message" / "already emailed … today"** is email loop protection working (see [Automations](09-automations.md#behind-the-scenes-how-a-rule-runs)).

**"Status 'Review' doesn't exist in this task's space".**
*Change status* uses the status **name** in each task's own space. Add that status to the space, or scope the rule.

## AI

| Message | Fix |
|---|---|
| "Add your Anthropic API key in Settings → AI" | Paste a key and **Save key**. |
| "Your … API key was rejected" | Copy the key again; check that it hasn't been revoked and that the account has credit. |
| "The selected Claude model was not found" / "does not have access" | Pick another model in Settings → AI. |
| "… is rate-limiting requests" | Wait a minute; lower usage or effort. |
| "Could not reach Ollama. Is it running?" | Start Ollama (`ollama serve`); check the server address. |
| "Model not found in Ollama" | `ollama pull <model>`. |
| The assistant doesn't use tools with Ollama | Choose a model that supports tool calling. |
| Weird dates from Quick add | Check the date before pressing Enter; invalid dates are ignored, never saved. |

## Calendar

**An event shows "Couldn't upload N event(s) (will retry)".**
The server refused a change (permissions, read-only calendar, server error). Other events still sync, and the change is retried at each sync. If it keeps failing, edit or delete the event in the calendar's own app.

**I can't change the time of a repeating event.**
Times of recurring series are read-only in FollowUp; change them in the calendar they come from.

## Notifications

**I don't get Windows notifications.**
- Check **Settings → Notifications** in FollowUp.
- Check Windows **Settings → System → Notifications** (FollowUp allowed, Do Not Disturb / Focus off).
- Notifications appear only while FollowUp is running.
- Developer builds (`npm run dev`) show in-app notifications only.

## Getting help

Still stuck? [Open an issue](../../README.md#reporting-bugs-and-getting-help). Include your FollowUp version (Settings → Updates), your Windows version, what you did, and any message shown. **Remove personal information** (email addresses, names, task contents) from screenshots first.
