# Contributing to FollowUp

Thanks for wanting to help! Every contribution is welcome: bug reports, ideas, documentation fixes, translations of the guide, tests and code.

## Ways to help

- **Report a bug:** [open a bug report](https://github.com/miller-hack/FollowUp/issues/new?template=bug_report.yml). Steps to reproduce make a bug fixable.
- **Suggest a feature:** [open a feature request](https://github.com/miller-hack/FollowUp/issues/new?template=feature_request.yml). Describe the problem you want solved, not only the solution.
- **Improve the docs:** typos, unclear steps and missing scenarios in [docs/](docs/README.md) are great first contributions.
- **Write code:** look for issues labelled `good first issue` or `help wanted`, or propose your own change in an issue first.

For a security problem, **don't** open a public issue: see [SECURITY.md](SECURITY.md).

## Setting up

You need Windows 10/11, [Node.js](https://nodejs.org) 22 or newer (24 recommended) and Git.

```bash
git clone https://github.com/miller-hack/FollowUp.git
```

```bash
cd FollowUp
```

```bash
npm ci
```

```bash
npm run dev
```

`npm run dev` uses your normal FollowUp data folder. To keep development data separate, set `FOLLOWUP_DATA_DIR` first (see [building and releasing](docs/developer/building-and-releasing.md#development-mode)).

**Read first:**
- [Architecture](docs/developer/architecture.md): how the processes, the typed API, events, jobs and the scheduler fit together.
- [Customizing and extending](docs/developer/customizing.md): step-by-step recipes for the most common changes (a new automation trigger or action, an AI tool, a setting, a migration, a widget, a page).
- [Design decisions](docs/decisions/README.md): the reasons behind non-obvious choices.

## Making a change

1. **Discuss larger changes first.** Open an issue (or comment on one) before starting a big feature, so we can agree on the approach.
2. **Fork** the repository and create a branch from `main`, for example `fix/outbox-retry` or `feat/duplicate-task-action`.
3. **Keep it focused:** one fix or feature per pull request.
4. **Follow the existing code:**
   - TypeScript everywhere; no `any` unless unavoidable.
   - New API methods go in `src/shared/api.ts` (the contract) and `src/main/api.ts` (the implementation); read-only methods start with `get`, `list`, `query`, `search` or `test`.
   - Services validate their input and throw readable messages; the UI shows them.
   - Database changes are **new** migrations appended to `src/main/db/migrations.ts`. Never edit an existing one.
   - User-facing text is plain, friendly English.
   - Match the comment style around you: comments explain *why*, not *what*.
5. **Add tests:**
   - a service test in `tests/` for main-process logic;
   - a component test in `tests/renderer/` for UI logic;
   - a step in `tests/e2e/smoke.mjs` for a new screen or flow.
   See [testing](docs/developer/testing.md).
6. **Update the docs.** If users or developers would notice the change, update the relevant page in `docs/` and add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).
7. **Check everything passes:**
   ```bash
   npm run typecheck
   ```
   ```bash
   npm test
   ```
   ```bash
   npm run e2e
   ```
8. **Open a pull request** and fill in the template. CI runs the same checks on Windows.

## Commit messages

Use short, imperative messages with a type prefix, as in the existing history:

```
fix(mail): record a send as soon as SMTP accepts it
feat(automation): add a "duplicate task" action
docs(guide): explain follow-up send windows
```

Common types are `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci` and `chore`.

## Dependencies

New dependencies need a good reason; FollowUp keeps its footprint small. Pick a version published **at least 14 days ago** (see ADR-006), and check `npm audit` afterwards.

## Licensing of contributions

FollowUp is licensed under the [Apache License 2.0](LICENSE). By submitting a contribution, you agree that it is licensed under the same license (section 5 of the license), and that you have the right to submit it.

Thank you for making FollowUp better!
