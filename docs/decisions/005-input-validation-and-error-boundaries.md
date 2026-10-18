# ADR-005: Validate dates and structure at the service boundary; contain render errors

**Status:** Accepted · **Date:** 2026-10-16 · **Feature:** code-review-hardening

## Context
Services accept free-text dates (especially from AI tools), which later crash rendering. There's no error boundary, so one exception blanks the window (H5). `updateTask` doesn't validate `parent_id` or `status_id` (L1).

## Decision
- `isAppDate` / `isAppDateTime` in `@shared/dates`. Task, reminder, event and time-entry services reject invalid values with a readable message. AI tools surface that message to the model as a tool error.
- `updateTask`: `parent_id` must exist and must not be the task or one of its descendants (the task moves to the parent's list). A foreign `status_id` is mapped by name, then by type, within the task's space.
- Maintenance clears invalid stored task dates once and logs it in the activity log.
- Renderer `ErrorBoundary` around the routed page, task panel, assistant and compose dialog, with "Reload view". Formatting helpers tolerate bad input.

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Validate only in AI tools | Smallest change | Other writers (automations, future imports) stay unchecked | The service boundary covers every caller |
| Zod schemas for the whole IPC contract | Uniform | Large change | Disproportionate for this round |

## Consequences
### Positive
- Bad data can't enter through any path; UI failures stay local to one view.
### Negative
- Callers that relied on lenient dates now get errors (intended).
### Risks
- Over-strict validation could reject legitimate input. The format is exactly what every UI picker produces.
