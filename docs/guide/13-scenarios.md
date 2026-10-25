# 13. Scenarios: putting it all together

Each scenario is a complete, realistic setup: what to create, which settings and rules to use, and what happens day to day. Mix and match them.

---

## 1. Freelancer: clients, email and billable time

**Situation:** you work for 4–6 clients. Requests arrive by email, you bill by the hour, and invoices sometimes go unpaid.

**Set up once**
1. **Space *Clients*.** One list per client (*Acme*, *Northwind*, …) plus a list *Admin*. Add a custom field *Billing* (Dropdown: Hourly / Fixed) and a tag `waiting`.
2. **Connect your email** (Settings → Accounts).
3. **Clients:** add each client company (or **From email**) with the person who pays invoices ticked as **Acts for them**.
4. **Automations:**
   - **Client emails → tasks.** WHEN *An email arrives* · IF *Sender contains `@acme.example`* · THEN *Create task from the email* (list *Acme*) · *Send me a notification "Acme: {{email.subject}}"*. Duplicate it for each client.
   - **Due tomorrow.** Use the template *Heads-up the day before*, scoped to space *Clients*.

**Every day**
- Open **Home**. Start the **timer** on the task you're working on (one click in the List view).
- Answer requests from the **Inbox**. When you've done one, mark the task done, and press **Done** on the thread.

**Every week or month**
- **Time tracking → Export CSV** for each week of the billing period. Filter by List (client) in Excel to build the invoice.
- Send the invoice email. If the client doesn't answer within 30 working hours, it appears in **Follow-up → Waiting on them** with a polite reminder ready; send it with one click, or snooze it until the payment date.

---

## 2. Sales follow-up machine

**Situation:** you send proposals and quotes, and deals die when nobody follows up.

**Set up once**
1. **Settings → Follow-up:** your working days, and your company's domains so your colleagues' replies count.
2. **Clients:** import your lead list (Excel), or add people **From email**. Set each company's **stage** and **our owner**.
3. **AI** (Settings → AI) so follow-ups are written for you from each conversation.
4. **AI triage** (optional): Settings → AI → **Sort new email automatically**. Then an automation:
   - WHEN *AI classifies a new email as "Needs reply"*
   - THEN *Create task from the email* (list *Deals*) · *Send me a notification*

**What happens**
- You send *"Proposal for the website redesign"* to Jordan at Northwind.
- After 30 working hours without an answer, it appears in **Follow-up → Waiting on them**, marked *Northwind · Proposal sent*.
- You open it: the AI has written a short follow-up that mentions your call last Thursday (logged in Clients). You change one sentence and click **Send follow-up**.
- When Jordan replies, the conversation leaves Follow-up. If you don't answer him within a working day, it comes back under **Reply needed**.
- In **Clients**, Northwind's history shows the proposal, the follow-up, Jordan's answer and your logged call, and **Responds: Yes** next to Jordan.

---

## 3. Product launch with a small team

**Situation:** a 5-week website launch with design, build and content in parallel, and a hard date.

**Set up once**
1. **Space *Work*** with statuses To Do → In Progress → Review → **QA** (Active) → Done. Add a list *Website Launch*.
2. **Tasks** with start and due dates. On the **Gantt**, drag bars into a schedule. Add **dependencies** (*Build pages* waits on *Design mockups*) so arrows show the critical path.
3. **Sprints:** *Sprint 1* and *Sprint 2* (two weeks each). Assign tasks and **Start sprint**.
4. **Goal** *Launch the new website*, with a **Tasks** key result linked to the launch tasks and a **Number** key result *Leads from the new site* (target 50).
5. **Dashboard** *Launch*:
   - *Sprint burndown*;
   - *Tasks by status* (location: Website Launch);
   - *Task list: Overdue*;
   - *Time by tag*;
   - *Goals*.
6. **Automations:**
   - *Status changes to Review* (scope: Website Launch) → *Add checklist "QA"* (Desktop, Mobile, Accessibility) · *Set due date in 2 days*.
   - *Status changes to Done* (scope: Website Launch) → *Post to Teams "✅ {{task.title}} done"*.

**Every day**
- Stand-up on the sprint's **Board**; watch the burndown.
- **Complete sprint** at the end: unfinished work rolls into the next sprint automatically.

---

## 4. Inbox zero with AI

1. Settings → AI: choose a provider. Turn on **Sort new email automatically**, then click **Sort current inbox now**.
2. In the Inbox, use the **category chips**:
   - *Newsletter* and *Notification*: skim, then press **Done**;
   - *Needs reply*: open, use **✨ AI → Draft a reply…** with a one-line instruction, edit, send;
   - *Needs action*: **✨ AI → Find tasks in this email** → pick a list → create the tasks.
3. An automation for *Likely spam*:
   - WHEN *AI classifies a new email as "Likely spam"*
   - THEN *Mark the email as read*

What remains in the Inbox is only what you haven't dealt with.

---

## 5. Meetings that prepare themselves

1. Connect your calendar (Sign in with Google, or CalDAV).
2. Automation **Meeting heads-up:**
   - WHEN *A calendar event is about to start, 15 minutes before*
   - THEN *Send me a notification "Up next: {{event.title}}"*
   - plus *Post to Slack "Starting at {{event.start}}: {{event.title}}"* if your team uses Slack
3. For focus work, open a task and click **Block time**. It lands on your calendar for the task's estimate, so colleagues can see you're busy (for synced calendars).
4. After the meeting, paste notes into a task's description and use **✨ Suggest subtasks**.

---

## 6. Personal admin on autopilot

1. **Space *Home*.**
   - List *Bills*: *Pay rent* (monthly, due on the 1st, reminder 1 day before), *Credit card* (monthly), *Car insurance* (yearly).
   - List *Errands*.
2. Every time you tick a bill off, next month's appears with the dates shifted.
3. **Settings → Notifications:** daily summary at 07:30. **Settings → Window & startup:** start with Windows, so reminders arrive even if you never open the window.
4. **Quick add with AI** while on the go: `Ctrl+N`, *"buy birthday present for mum before Saturday #family"*, `Alt+Enter`, Enter.

---

## 7. Capturing requests from Slack

1. Create a Slack app (bot token) and invite it to `#requests`.
2. Settings → Slack & Teams → **＋ Slack** → paste the token → choose `#requests`. Turn on **Create tasks from messages with a reaction**: reaction `memo` (📝), list *Requests*.
3. Automation:
   - WHEN *A task is created* (scope: list *Requests*)
   - THEN *Set due date in 2 days* · *Add tag "slack"* · *Send me a notification "New request: {{task.title}}"*
4. Anyone in the channel can now turn a message into a task with 📝. The task links back to the Slack message.

---

## 8. Weekly review ritual

1. Automation **Weekly review:** *On a schedule, every week on Friday at 16:00* → *Create task "Weekly review — {{date.today}}"* in *Personal*, due today, priority High.
2. On Friday:
   - open **Home** and click **Review my week** for an AI summary of wins, time, risks and a plan;
   - check **Dashboards → Overview**;
   - in **Everything → List**, filter *Due: Overdue*, select all and re-plan with **bulk due date**;
   - complete the review task.

---

## 9. Bug tracking for a small product

1. **Space *Product*.**
   - Statuses: New → Triaged → In Progress → Review → Done (plus *Won't fix*, type Done).
   - Custom fields: *Severity* (Dropdown: S1–S4), *Version* (Text), *Area* (Labels).
2. **Automations:**
   - *A task is created* (scope: list *Bugs*) · IF *Due date is not set* → *Set due date in 7 days* · *Add checklist "Triage"* (Reproduce, Find cause, Estimate).
   - *A tag is added: `s1`* (scope: *Bugs*) → *Change priority Urgent* · *Send me a notification "S1 bug: {{task.title}}"*. (A tag is used because Quick add can't set custom fields; tag the bug `s1` when you file it.)
   - *Status changes to Done* (scope: *Bugs*) → *Add comment "Fixed on {{date.today}}"*.
3. **Dashboard:** *Tasks by priority* (location *Bugs*), *Completed over time* (30 days).

---

## Tips for designing your own workflows

- **Start with the trigger.** Ask "what event tells me this needs doing?"
- **Narrow with scope and conditions.** Most surprises come from rules that run "anywhere".
- **Test before saving.** Use **Test** with a real task or email, then watch **Run history** for a day.
- **Keep chains short.** Rules can trigger rules (up to 5 deep); simpler is easier to reason about.
- **Same status names across spaces** make Board views, bulk edits and status rules work everywhere.
- **Keep FollowUp running** (tray plus start with Windows) so time-based rules and follow-ups fire on time.
