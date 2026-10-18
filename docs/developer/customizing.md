# Customizing and extending FollowUp

This page is a cookbook. Each recipe lists **exactly which files to change**, in order, with code that matches the existing style.

Read [Architecture](architecture.md) first for the big picture. TypeScript is your friend here: most catalogues are `Record<Union, …>` types, so when you add a new trigger or action type, the compiler points out every place that still needs an entry (`npm run typecheck`).

## Setup

```bash
npm ci
```

```bash
npm run dev
```

`npm run dev` starts the app with hot reload; renderer changes appear immediately, and main-process changes restart the app. Your dev data lives in `%APPDATA%\FollowUp` too. To keep it separate, use a throwaway folder:

```powershell
$env:FOLLOWUP_DATA_DIR = "$env:TEMP\followup-dev"; npm run dev
```

Before committing: `npm run typecheck`, `npm test`, and for UI changes `npm run e2e`.

## How a click becomes a change (trace)

Clicking the round status icon on a task:

1. `features/tasks/pickers.tsx` → `StatusCircle` calls `onChange(doneStatusId)`.
2. The list row calls `optimisticPatch(...)` (instant UI) and `api.updateTask(id, { status_id })`.
3. `lib/api.ts` → `window.bridge.invoke('updateTask', [id, patch])` → IPC.
4. `src/main/index.ts` checks the sender → `api.updateTask` (`src/main/api.ts`) → `tasks.updateTask` (`src/main/services/tasks.ts`).
5. Inside `tx(...)`, `updateTask`:
   - validates the change;
   - writes the change, sets `completed_at`;
   - writes the activity entry;
   - emits `task.status_changed`;
   - creates the next occurrence if the task repeats.
6. `services/automation.ts` (listening) queues an `automation` job for every matching rule, in the same transaction.
7. The handler returns, then the main process broadcasts `data-changed`, and every open view refetches.
8. Moments later, the job runner executes the queued rules.

Keep this flow in mind; most features follow it.

---

## Add an API method

*Example: `getOpenTaskCount(listId)`.*

1. **Contract:** `src/shared/api.ts`, in `interface Api`:
   ```ts
   getOpenTaskCount(listId: string): number
   ```
   **Naming matters.** Methods starting with `get`, `list`, `query`, `search` or `test` (`READ_ONLY_PREFIXES`) are treated as read-only. Every other method is a mutation, and after it the UI refetches everything.
2. **Service:** in `src/main/services/tasks.ts`:
   ```ts
   export function getOpenTaskCount(listId: string): number {
     return get<{ n: number }>(
       "SELECT COUNT(*) n FROM tasks t JOIN statuses s ON s.id = t.status_id WHERE t.list_id = ? AND s.type <> 'done'",
       listId
     )?.n ?? 0
   }
   ```
3. **Wire it:** `src/main/api.ts`, `getOpenTaskCount: tasks.getOpenTaskCount,`.
4. **Use it:** in the renderer, `api.getOpenTaskCount(id)`, usually wrapped in a hook in `lib/hooks.ts`:
   ```ts
   export const useOpenTaskCount = (listId: string) =>
     useQuery({ queryKey: ['openCount', listId], queryFn: () => api.getOpenTaskCount(listId) })
   ```
5. **Test it** in `tests/*.test.ts` (services run against an in-memory database; see [Testing](testing.md)).

---

## Add an automation trigger

*Example: **"Due date changes"**.*

1. **Catalogue:** `src/shared/automation.ts`
   ```ts
   export type Trigger =
     | …
     | { type: 'due_date_changed' }
   ```
   and in `TRIGGER_CONTEXT`: `due_date_changed: 'task',`. Use `'email'` or `'none'` for other contexts. The context decides which actions, conditions and variables the editor offers.
2. **Event** (for event-based triggers): `src/main/services/events.ts`, add to `DomainEvent`:
   ```ts
   | { type: 'task.due_changed'; taskId: string; from: string | null; to: string | null }
   ```
3. **Emit it:** `src/main/services/tasks.ts` → `updateTask`, in the due-date branch:
   ```ts
   if (patch.due_date !== undefined && patch.due_date !== before.due_date) {
     set('due_date', patch.due_date)
     log(id, 'due date', patch.due_date ?? 'cleared')
     events.push({ type: 'task.due_changed', taskId: id, from: before.due_date, to: patch.due_date })
   }
   ```
   Events are emitted at the end of the transaction (`events.forEach(emit)`).
4. **Match it:** `src/main/services/automation.ts` → `triggerMatches`:
   ```ts
   case 'due_date_changed':
     return e.type === 'task.due_changed'
   ```
   For **time-based** triggers, skip steps 2–4. Instead add a branch in `automationTick()`, and record a fire-once key with `fireOnce(rule.id + ':<something unique>')` so it fires once per thing.
5. **Label it:** `src/renderer/src/features/automations/describe.ts`:
   - `TRIGGER_LABELS.due_date_changed = 'Due date changes'`;
   - a case in `describeTrigger` if it has options.
6. **Offer it in the editor:** `AutomationEditor.tsx` → `TriggerEditor`. Add `'due_date_changed'` to the right `<optgroup>` list. If it has options, add their inputs, plus defaults in `defaultTrigger()`.
7. **Test** in `tests/automation.test.ts`:
   1. create a rule;
   2. change a due date;
   3. `await processJobs()`;
   4. assert the action's effect.

## Add an automation action

*Example: **"Duplicate the task"**.*

1. `src/shared/automation.ts`:
   - add `| { type: 'duplicate_task' }` to `Action`;
   - add `'duplicate_task'` to `TASK_ACTIONS` (needs a task; use `EMAIL_ACTIONS` for email-only actions, or neither for "any").
2. `src/main/services/automation.ts`:
   - validation in `validateAutomation()` if it has required fields;
   - a case in `executeAction()`:
     ```ts
     case 'duplicate_task': {
       const copy = duplicateTask(need().id)
       return `Duplicated as “${copy.title}”`
     }
     ```
     Import `duplicateTask` from `./tasks`. The returned string appears in the run history. Throw an `Error` with a readable message to fail the run, and the whole run rolls back. For slow work (network, AI), `enqueue()` a job instead of doing it inline (see `ai_prompt`).
3. Renderer:
   - `describe.ts`: `ACTION_LABELS.duplicate_task = 'Duplicate the task'` and a case in `describeAction`;
   - `AutomationEditor.tsx`: a case in `defaultAction()` (`return { type }`) and in `ActionFields` (inputs for its options, or a short hint).
4. **Test** it like a trigger.

## Add a condition field

*Example: **Start date is set / is not set**.*

1. `src/shared/automation.ts`: add `'start_date'` to `ConditionField`.
2. `src/main/services/automation.ts` → `evalCondition`: add `case 'start_date': actual = t.start_date; label = …; break`. The generic operator switch below handles `is_set` and `is_not_set`.
3. `AutomationEditor.tsx`:
   - `FIELD_LABELS.start_date = 'Start date'`;
   - `OPS.start_date = [['is_set', 'is set'], ['is_not_set', 'is not set']]`.
4. `describe.ts` → `describeCondition`: a case returning readable text.

Email fields must also be listed in `EMAIL_FIELDS`, so that only email triggers offer them.

## Add a template variable

*Example: `{{task.start_date}}`.*

1. `src/shared/automation.ts` → `TEMPLATE_VARS.task`: add `'{{task.start_date}}'` (shown as a chip in the editor).
2. `src/main/services/automation.ts` → `renderTemplate`: add `'task.start_date': t?.start_date ?? ''`.

## Add a built-in automation template

`src/renderer/src/features/automations/AutomationsPage.tsx` → `templates()`. Append `{ title, description, rule: base({ name, trigger, conditions, actions }) }`. It appears under **Templates** and opens in the editor.

---

## Add an AI assistant tool

All tools live in `src/main/services/ai/tools.ts`, in the `TOOLS` array. The assistant picks them up automatically, for every provider.

```ts
tool(
  'complete_task',                                   // name the model sees
  'Mark a task as done.',                            // when to use it
  { task_id: str('Task id') },                       // input schema (str / num / bool / oneOf / opt)
  true,                                              // needsApproval: true for anything that changes data
  (i) => {                                           // runs inside a DB transaction after approval
    const t = getTask(i.task_id as string)
    if (!t) throw new Error('Task not found')
    const done = get<{ id: string }>(
      "SELECT s.id FROM statuses s JOIN lists l ON l.space_id = s.space_id WHERE l.id = ? AND s.type = 'done' ORDER BY s.position",
      t.list_id
    )
    updateTask(t.id, { status_id: done!.id })
    return { done: true }                            // JSON back to the model
  },
  (i) => `Complete “${get<{ title: string }>('SELECT title FROM tasks WHERE id = ?', i.task_id)?.title ?? 'task'}”`  // approval card text
)
```

**Guidelines:**
- **Read tools** set `needsApproval: false` and should return compact JSON. Use `taskLine()` and `clip()`, and avoid huge payloads; results over 20,000 characters are truncated.
- **Write tools** set `needsApproval: true`. Write a `summarize()` that tells the user exactly what will happen.
- **Never send email** from a tool. Use `uiAction({ type: 'compose', … })` like `draft_email`.
- **Behaviour:** the system prompt in `ai/assistant.ts` (`SYSTEM`) tells the model how to behave. Keep it short; it's frozen per conversation for prompt caching.

## Add an inline AI feature

*Example: **"Estimate this task"**.*

1. `src/main/services/ai/features.ts`:
   ```ts
   export async function aiEstimateTask(taskId: string): Promise<{ minutes: number; reason: string }> {
     return ask(
       'estimate',
       {
         effort: 'low',
         system: `You estimate how long work items take for one person. ${DATA_NOTE}`,
         prompt: `Estimate the time this task needs.\n<data>\n${taskContext(taskId)}\n</data>`
       },
       {
         json: obj({ minutes: { type: 'integer' }, reason: { type: 'string' } }),
         zod: z.object({ minutes: z.number().int(), reason: z.string() })
       }
     )
   }
   ```
   `ask()` picks the configured provider, requests structured JSON, validates it with zod, and logs usage under the feature name. Always wrap untrusted text in `<data>` and include `DATA_NOTE` (prompt-injection defence).
2. **API:** in `shared/api.ts`, add `aiEstimateTask(taskId: string): Promise<{ minutes: number; reason: string }>`; in `main/api.ts`, `aiEstimateTask: aiFeatures.aiEstimateTask`.
3. **UI:** add a `MenuItem` to `features/ai/TaskAi.tsx` and show the result in `TaskAiCard`.

## Change AI models or defaults

| What | Where |
|---|---|
| Claude model list and prices (for cost estimates) | `src/shared/ai.ts` → `ANTHROPIC_MODELS` |
| Default provider, models, effort, auto-sort | `src/main/services/meta.ts` → `DEFAULT_SETTINGS.ai` |
| Provider request details (thinking, caching, betas, max tokens) | `src/main/services/ai/providers.ts` |
| Feature prompts | `src/main/services/ai/features.ts` |
| Assistant behaviour | `SYSTEM` in `src/main/services/ai/assistant.ts`, `MAX_STEPS` |
| Triage categories | `EmailCategory` / `EMAIL_CATEGORY_LABEL` in `shared/ai.ts` + `CATEGORIES` in `features.ts` |

---

## Add a setting

1. `src/shared/types.ts` → `interface Settings`: add the field. Use a nested object if it belongs to a group.
2. `src/main/services/meta.ts` → `DEFAULT_SETTINGS`: give it a default. If you add a **new nested group**, also add its key to `NESTED`, so partial stored values merge correctly. Existing users get the default automatically; no migration is needed.
3. **UI:** `src/renderer/src/features/settings/Settings.tsx`. Use `<Toggle …>`, a `<select>` or `<Segmented …>`, and save with `set({ … })`.
4. **Use it:** `getSettings().yourField` in the main process, or `useSettings()` in the renderer. If changing it needs an OS side effect, add that to `applySettings()` in `desktop.ts`.

## Add a database column or table

1. Append a migration to `src/main/db/migrations.ts`. **Never edit old ones.**
   ```ts
   `
   ALTER TABLE tasks ADD COLUMN color TEXT;
   CREATE INDEX IF NOT EXISTS idx_tasks_color ON tasks(color);
   `
   ```
2. Update the TypeScript types (`src/shared/types.ts`) and the service's `SELECT` column lists (e.g. `TASK_COLS` in `tasks.ts`).
3. If users should export it, check `exporter.ts` (`USER_TABLES` covers whole tables automatically).
4. Add a test that opens a fresh database (`openDb(':memory:')` runs every migration).

## Add a background job

```ts
// anywhere in a service module
registerJobHandler<{ taskId: string }>('my_job', async ({ payload, attempts }) => {
  // throw to retry with backoff (30 s, 2 min, 8 min, …)
}, (job, error) => {
  // optional: called once after the final failed attempt
})

enqueue('my_job', { taskId }, { maxAttempts: 3 /*, runAt: new Date(...) */ })
```

- Make handlers **idempotent**: a crash can make a job run again.
- If the job sends something, record "sent" **immediately** after the external call succeeds (see `send.ts`, ADR-004).

## Run something on a timer

Add it to `tick()` in `src/main/desktop.ts`, which runs every 30 seconds while the app runs. Throttle it yourself, like the mail sync does with `lastMailSync`. Queue jobs instead of doing slow work inside the tick.

## Add a dashboard widget type

1. `src/shared/types.ts`: add to `WidgetType`; reuse or extend `WidgetConfig` and the `WidgetData` union.
2. `src/main/services/dashboards.ts` → `computeWidget()`: a new case returning `WidgetData`.
3. `src/renderer/src/features/dashboards/DashboardsPage.tsx`: an entry in `CATALOG` (label, description, icon, default size and config), plus rendering for the new data `kind` (if it's new).

## Add a page

1. Create `src/renderer/src/features/<name>/<Name>Page.tsx`.
2. Add a route in `src/renderer/src/App.tsx`: `<Route path="/name" element={<NamePage />} />`.
3. Add a sidebar link in `features/sidebar/Sidebar.tsx` (the nav array) and, optionally, a command in `features/search/CommandPalette.tsx`.

## Change defaults, seed data and branding

| What | Where |
|---|---|
| Default statuses of new spaces | `DEFAULT_STATUSES` in `src/main/services/hierarchy.ts` |
| Example workspace on first run | `src/main/services/seed.ts` |
| Colours and theme tokens | `src/renderer/src/styles.css` (light and dark variables) |
| App icon | `build/icon.ico` / `build/icon.png`; regenerate with `npm run icon` (`scripts/make-icon.mjs`) |
| App name / id / installer options | `electron-builder.yml` (`appId`, `productName`, `nsis.*`), `package.json` (`productName`); keep the AppUserModelID in `desktop.ts` (`APP_USER_MODEL_ID`) in sync with `appId` |
| Built-in Google/Microsoft sign-in client IDs | `.env` with `MAIN_VITE_GOOGLE_CLIENT_ID`, `MAIN_VITE_GOOGLE_CLIENT_SECRET`, `MAIN_VITE_MICROSOFT_CLIENT_ID` at build time |
| Update server baked into the installer | `FOLLOWUP_UPDATE_URL` when running `npm run dist` |

## Checklist for any change

- [ ] Validation in the service, with error messages a user understands
- [ ] Writes inside `tx(...)`, events emitted in the same transaction
- [ ] No secrets sent to the renderer
- [ ] Tests: service tests in `tests/`, component tests in `tests/renderer/`, E2E step for new screens
- [ ] `npm run typecheck && npm test` pass; `npm run e2e` for UI changes
- [ ] Docs: the matching chapter in `docs/guide/` and, for non-obvious choices, a new ADR in `docs/decisions/`
