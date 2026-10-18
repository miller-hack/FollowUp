# Testing

FollowUp has four layers of tests. None of them needs an internet connection, a real mailbox or an AI key: everything external is replaced by a small local fake server.

| Layer | Command | Runs in | What it proves |
|---|---|---|---|
| Unit / service | `npm test` (project `main`) | Node, in-memory SQLite | The services (tasks, automations, mail, AI, integrations…) behave correctly |
| Component | `npm test` (project `renderer`) | jsdom, IPC bridge stubbed | React components render and react to input correctly |
| End-to-end | `npm run e2e` | The real built Electron app | The whole app works together, screen by screen |
| Release | `npm run test:update` | Real installers, Windows | The installer installs and an installed copy updates itself |

Run `npm run typecheck` as well: it checks the main process, the renderer **and** the tests.

## Unit and service tests (`tests/*.test.ts`)

These call the main-process services directly, against a fresh **in-memory** database per test:

```ts
beforeEach(() => {
  closeDb()
  openDb(':memory:')   // runs every migration, so the schema is exactly what users get
})
```

| File | Covers |
|---|---|
| `tasks.test.ts` | Spaces, lists and statuses, tasks and subtasks, recurrence, dates |
| `phase2.test.ts` | Time tracking, goals, sprints, dashboards, notifications |
| `automation.test.ts` | Event and time-based triggers, conditions, actions, scopes, loop safety, the job queue and dry runs |
| `mail.test.ts` | Mail parsing, accounts and sync, sending, follow-up sequences, email automations, calendar (fake IMAP + SMTP) |
| `ai.test.ts` | The Claude provider and assistant loop, keys, triage, AI automations, the OpenAI-compatible provider (fake servers) |
| `phase6.test.ts` | Slack and Teams, Sign in with Google (OAuth, token refresh), `.ics` export (fake servers) |
| `hardening.test.ts` | Security and robustness rules from the code review (ADR-001 to 008) |
| `release.test.ts` | 1.0 behaviour: inline mail images, legacy mail conversion, compaction, backup retention, the close choice (ADR-009 to 012) |

**Fake servers used:**
- **IMAP:** `hoodiecrow-imap`, an in-memory IMAP server; mailboxes are declared as raw RFC 822 messages.
- **SMTP:** `smtp-server`, which captures what was "sent".
- **HTTP APIs** (Claude, OpenAI, Slack, OAuth, CalDAV): `node:http` servers that answer by request shape. The app is pointed at them with a base URL (for example `ANTHROPIC_BASE_URL`, `FOLLOWUP_SLACK_API`).

### Writing a service test

1. Pick the file for the area (or add `tests/<area>.test.ts`).
2. Create the data you need through the services, never with raw SQL, so the test exercises the same code as the app.
3. Act, then assert on what the services return.
4. Time-dependent code takes dates as arguments or uses `localDate()`; prefer passing a fixed date to relying on "now".

```ts
it('runs actions when a task is created, respecting conditions', async () => {
  const { list } = setup()
  auto.createAutomation(rule({
    trigger: { type: 'task_created' },
    conditions: [{ field: 'due_date', op: 'is_not_set' }],
    actions: [{ type: 'set_due_date', days_from_now: 7 }]
  }))
  const a = t.createTask({ list_id: list.id, title: 'No date' })
  await processJobs()            // automations run as jobs: drain the queue
  expect(t.getTask(a.id)!.due_date).toBe(addDays(localDate(), 7))
})
```

(From `tests/automation.test.ts`; `rule()` fills in the defaults of an `AutomationInput`.)

## Component tests (`tests/renderer/*.test.tsx`)

These render React components in jsdom. `tests/renderer/setup.ts` replaces `window.bridge` with a stub: each test registers the API answers it needs in `handlers`, and anything else returns `null`.

```ts
import { handlers } from './setup'

handlers.listTasks = () => [{ id: 't1', title: 'Write report', … }]
render(<ListView … />)
expect(await screen.findByText('Write report')).toBeTruthy()
```

The setup also stubs the browser APIs jsdom lacks (`ResizeObserver`, range rectangles for the editor, `scrollIntoView`). Components that need TanStack Query get a fresh `QueryClient` per test.

`components.test.tsx` covers shared pieces (error boundary, modal, date picker); `views.test.tsx` covers the List view (including virtualisation), the rich-text editor and the email body viewer.

## End-to-end test (`tests/e2e/smoke.mjs`)

`npm run e2e` builds the app and drives the **real** Electron window with Playwright:

1. It starts a fake IMAP and SMTP server (with sample mails: HTML, a disguised `.exe`, an inline image), a fake Claude server that streams like the Messages API, and a fake Slack server.
2. It launches the app with a throwaway data folder (`FOLLOWUP_DATA_DIR`) and `ANTHROPIC_BASE_URL` pointing at the fake Claude server, so your real FollowUp data is never touched.
3. It walks through every main screen: creating tasks, views, the editor, email sync and reply, follow-ups, automations, the assistant with an approval card, Slack, settings, closing to the tray. It saves a screenshot after each step.
4. It fails on any console error or failed step.

```bash
npm run e2e -- C:\temp\shots
```

The optional argument is where screenshots go (default: a temp folder). In CI, they are uploaded when the run fails.

**When you add a screen or a flow, add a step here.** Use roles and visible text as selectors (`getByRole('button', { name: 'Save' })`), as users see them, not CSS classes.

## Release test (`tests/release/update-test.mjs`)

`npm run test:update` takes a few minutes. It:
1. builds two installers, version 0.9.0 and the current version, both pointing at a local update server;
2. installs 0.9.0 silently into a temp folder;
3. launches it, waits until it finds and downloads the update, and clicks **Restart and update**;
4. checks that the installed program is now the current version;
5. uninstalls and cleans up.

Both builds use a separate **release-test identity** (`FOLLOWUP_RELEASE_TEST=1`): a different app id, name, data folder and updater cache, and no shortcuts. A FollowUp installed on the same PC is never touched (ADR-012). `REUSE_BUILDS=1` skips rebuilding when the installers in `dist-update/` are current.

Run it before every release and after any change to `updater.ts`, `electron-builder.yml` or `scripts/dist.mjs`.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request, on `windows-latest`: `npm ci` → typecheck → `npm test` → `npm run e2e` → `npm run dist`. The installer is kept as a build artifact for 14 days. Actions are pinned to full commit SHAs.

## Before opening a pull request

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run e2e
```

All three must pass. CI runs them again.
