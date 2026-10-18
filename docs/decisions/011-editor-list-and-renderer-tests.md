# ADR-011: Tiptap 3, virtualised list view, renderer component tests

**Status:** Accepted · **Date:** 2026-10-17 · **Feature:** release-1-0

## Context
- **Tiptap:** Tiptap 2.x carries a moderate advisory (`mergeAttributes` `__proto__`, fixed in 3.30.4).
- **List view:** it renders every row. Thousands of tasks mean thousands of popover-laden rows.
- **Test coverage:** the renderer has no component tests. ErrorBoundary, dialogs and date inputs are only covered by E2E.

## Decision
1. **Tiptap 3.31.4** (≥ 14 days old), installed packages:
   - `@tiptap/react`
   - `@tiptap/pm`
   - `@tiptap/starter-kit`
   - `@tiptap/extensions`

   The separate link and placeholder packages are dropped.

   Code changes:
   - Link is configured through `StarterKit.configure({ link })`.
   - `Placeholder` comes from `@tiptap/extensions`.
   - Toolbar active state uses `useEditorState`, since v3 no longer re-renders on every transaction.
   - `setContent(html, { emitUpdate: false })`.
2. **`@tanstack/react-virtual` 3.14.13:**
   - ListView flattens groups, expanded subtasks and add-rows into one row array.
   - It renders only the visible window, plus 12 rows of overscan.
   - Rows are dynamically measured (`measureElement`). In-flow top and bottom spacers keep the sticky header and the min-content horizontal scroll unchanged.
   - Group spacing uses padding, not margin, so measurement is exact.
3. **Renderer tests:**
   - Packages: vitest 4 projects with `jsdom` 30.1.1, `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2 and `@testing-library/user-event` 14.6.7.
   - Location: `tests/renderer/**/*.test.tsx`, with a setup file that stubs `window.bridge`, `ResizeObserver` and layout sizes.

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Stay on Tiptap 2 and override `@tiptap/core` | Small change | Cross-major override is unsupported | Fragile |
| `react-window` | Mature | Fixed-size rows or manual measuring; no in-flow spacer mode | Rows vary (subtasks, tags) |
| Paginate the list | Simple | Breaks grouping, sorting and select-all | Worse UX |
| `happy-dom` | Faster | Weaker layout/Range support for ProseMirror | jsdom is the safer default |

## Consequences
### Positive
- No editor advisory, smooth lists at any size, and a real safety net for UI components.
### Negative
- Rows outside the viewport unmount: an open popover or a half-typed "New task" closes when scrolled far away.
### Risks
- **Tiptap 3 output.** Its HTML differs in edge cases (e.g. link attributes). Stored descriptions are plain HTML and load unchanged; a renderer test covers load and save.
