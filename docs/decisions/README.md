# Design decisions

These are FollowUp's **architecture decision records** (ADRs). Each one explains a choice that isn't obvious from the code: the problem, what was decided, the alternatives that were considered and why they lost, and the consequences that were accepted.

Read the relevant ADR before changing the area it covers. If you want to change a decision, write a new ADR that **supersedes** the old one rather than editing it. Accepted ADRs are a record of what was decided and why at the time.

| # | Decision | Area |
|---|---|---|
| [001](001-untrusted-attachment-handling.md) | Email attachments are stored under safe names with Mark of the Web; programs and scripts are never launched | Security |
| [002](002-privileged-window-and-ipc.md) | The main window only ever shows the app page; IPC answers only that page | Security |
| [003](003-per-item-failure-isolation.md) | One bad message, event or follow-up step never stops the rest of its sync or queue | Reliability |
| [004](004-at-most-once-email-send.md) | An email is recorded as sent the moment the server accepts it, so it's never sent twice | Email |
| [005](005-input-validation-and-error-boundaries.md) | Dates and task structure are validated in the services; render errors are contained to one area | Robustness |
| [006](006-dependency-upgrades.md) | Library upgrades, and the rule to adopt only versions at least 14 days old | Supply chain |
| [007](007-data-maintenance-and-indexes.md) | Indexes, data retention and cleanup, complete export | Data |
| [008](008-automated-mail-loop-protection.md) | Automations never auto-reply to automated mail and email a recipient at most once per rule per day | Automations |
| [009](009-app-identity-and-window-lifecycle.md) | One Windows identity ("FollowUp", never "Electron"); what closing the window does | Desktop |
| [010](010-inline-mail-images-and-compaction.md) | Pictures inside emails are stored once as files; the database is compacted; backups are capped | Data |
| [011](011-editor-list-and-renderer-tests.md) | Tiptap 3 editor, virtualised List view, component tests | UI |
| [012](012-ci-and-release-test-isolation.md) | The CI pipeline, and a release test that can never touch an installed FollowUp | Build |

## Writing a new ADR

Copy this outline into `NNN-short-title.md` (the next free number):

```markdown
# ADR-NNN: Title

**Status:** Proposed | Accepted | Superseded by ADR-NNN · **Date:** YYYY-MM-DD

## Context
The problem, the constraints, and why a decision is needed now.

## Decision
What was decided, specifically enough to implement.

## Alternatives considered
| Alternative | Pros | Cons | Why not |
|---|---|---|---|

## Consequences
What gets easier, what gets harder, and the risks.
```

Add it to the table above and mention it in your pull request.
