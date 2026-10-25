# 7. Follow-up

## What it's for

Follow-up makes sure no conversation goes quiet by accident. It lives in the Inbox and answers two questions every day:

- **Reply needed:** who has been waiting more than a day for an answer from you or your team?
- **Waiting on them:** which of your emails got no answer?

Open a conversation there and FollowUp writes the follow-up email for you from the whole conversation. You read it, change what you like, and click **Send follow-up**. Nothing is ever sent without that click.

![Follow-up](../images/followups.png)

## Key ideas

| Term | Meaning |
|---|---|
| **Us** | You and your team. That means every mailbox connected to FollowUp, plus your company's email domains: your mailboxes' own domains (except public ones like gmail.com) and any you add in Settings → Follow-up. A reply from a teammate counts, for example when you were in copy. |
| **Reply needed** | The latest real email in a conversation came from outside, and nobody on your side has answered for **24 working hours** (you can change this). |
| **Waiting on them** | The latest real email is yours (or a teammate's), it went to someone outside, and they haven't answered for **30 working hours** (you can change this). |
| **Working hours** | Only working days count (Monday–Friday unless you change it). An email that arrives on Friday evening needs a reply by Monday evening, not Saturday. |
| **Real email** | Auto-replies, out-of-office messages, mailing lists, newsletters, robots (no-reply…), drafts, and anything in Spam or Trash don't count. |

## How to use it

### 1. Open Follow-up
Click **Follow-up** in the left sidebar or in the Inbox's folder list. The number next to it is how many conversations need attention now.

- The **tabs** at the top filter: **All**, **Reply needed**, **Waiting on them**.
- The list is **sorted by priority**: emails AI marked as important first (when AI sorting is on), then the ones that have waited longest.
- Each row says how long it has waited ("Waiting for your reply for 3 days", "No answer to your email for 2 days"). It also shows the client company and stage when the person is in [Clients](15-clients.md).

### 2. Write the follow-up
Click a conversation. Above the messages, a yellow panel says who is waiting and since when, and a draft is ready below it:

- **To / Cc** are filled in for you:
  - **Reply needed:** the person who wrote, with the other outside people from their email in Cc.
  - **Waiting on them:** the people you wrote to.
- **Subject:** "Re: …", so it stays in the same conversation for everyone.
- **The text:**
  - With AI set up ([AI](10-ai.md)), it's written from the last 10 messages of the conversation. It also uses the client's company, stage and latest logged calls or meetings, so it can say "as discussed on Thursday…".
  - Without AI, it's a short polite template to complete.
- **Rewrite:** type what to change ("mention the revised price", "shorter", "more formal") and click **Rewrite**.
- **Send follow-up** sends it, as a reply in the conversation. **Save as draft** keeps it in your Drafts folder (also on the server). **Discard** throws the draft away.

Outside the Follow-up view, the same panel appears on any conversation that is waiting. There it doesn't write a draft until you click **Write follow-up**.

### 3. Snooze or dismiss
- **Snooze** (tomorrow 9:00, in 3 days, next Monday, in 2 weeks) hides the conversation until then.
- **No follow-up needed** hides it until a new message arrives in that conversation. Use it for "thanks!" emails.
- **Bring back** undoes either.

### 4. It leaves Follow-up when…
- someone on your side replies (from FollowUp or from any connected mailbox, or a teammate from your company domain);
- they reply to you;
- you mark the conversation **Done**, move it to Spam or Trash, or it gets older than the look-back period (14 days by default).

Your follow-up starts a new clock: after you answer a "reply needed" email, the conversation becomes "waiting on them" if they then don't answer.

## Settings
**Settings → Follow-up:**

| Setting | Default | What it does |
|---|---|---|
| Your mailboxes' own domains | On | Treats e.g. everyone `@yourcompany.com` as your team |
| Other company domains | — | More domains that count as your team (subsidiaries, old domains) |
| Working days | Mon–Fri | Only these days count towards the waiting time |
| "Reply needed" after | 1 working day | 4, 8, 12 hours or 1, 2, 3 working days |
| "Waiting on them" after | 30 working hours | 1, 2, 3, 5 or 7 working days |
| Look back | 14 days | Older conversations are never brought up |
| Daily reminder | On | One notification at your daily summary time when something needs follow-up |

## Email templates
Templates are still available in **Compose → Insert template…**. They support `{{first_name}}`, `{{name}}` and `{{subject}}`.

## Behind the scenes
- **Where the logic lives:** `src/main/services/mail/followups.ts`, `followupDraft.ts`, and `aiDraftFollowUp` in `ai/features.ts`. The design is in [ADR-015](../decisions/015-follow-up-in-the-inbox.md).
- **The rule** (`followUpState`) looks at the conversation's latest real message:
  - if the sender isn't "us", it's **reply**;
  - if it's ours and went to at least one outside address, it's **nudge**;
  - otherwise (an internal email) it's nothing.
- **Due time:** the waiting time is added in working hours (`addWorkingHours`). Each day that isn't a working day is skipped entirely.
- **Stored on the conversation:** the kind, the message the clock started from, and the due time. FollowUp recomputes them:
  - after every sync and every email sent;
  - when you change the settings or add or remove an account;
  - every 5 minutes (the clock moves on).
- **Snooze and dismiss:** a snooze stores a time. "No follow-up needed" remembers the message it applied to, so a new message brings the conversation back.
- **The draft** is generated only when you open the conversation (no AI cost for ones you skip), and never sent automatically. Sending goes through the normal outbox: retried if the server is busy, and never sent twice ([ADR-004](../decisions/004-at-most-once-email-send.md)).
- **Daily reminder:** once a day after your digest time, if anything is due.

## How it connects

| Feature | Connection |
|---|---|
| [Email](06-email.md) | Follow-up is a view of your synced mail; replies sent anywhere count |
| [Clients](15-clients.md) | Rows show the client's company and stage; drafts use the client's latest logged contact |
| [Automations](09-automations.md) | Trigger **"An email needs follow-up"** (either kind, or only one) runs once per waiting email, e.g. to create a task or notify a teammate |
| [AI](10-ai.md) | Writes the drafts; sorts by AI priority; the assistant can list what needs follow-up (`list_follow_ups`) |

## Examples
- **Sales:** a buyer asks for prices on Tuesday and you're travelling. On Wednesday afternoon the email is in **Reply needed**, and the draft already answers with what was in the thread. Your colleague in copy replied in the meantime? Then it never shows up.
- **Vendors:** you asked a supplier for delivery dates on Thursday. On Friday evening (30 working hours later, counting Thursday and Friday) it appears in **Waiting on them** with a short, friendly nudge ready to send.
- **Not every email needs an answer:** "Thanks, received!" goes to **No follow-up needed** with one click.

> **Coming from 1.0?** Automatic follow-up sequences were replaced by this view. Sequences that were running stopped when you updated, and automation rules that started sequences were switched off (they say so in Automations).
