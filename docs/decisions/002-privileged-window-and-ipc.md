# ADR-002: Lock the privileged main frame to the app page; authenticate IPC senders

**Status:** Accepted · **Date:** 2026-10-16 · **Feature:** code-review-hardening

## Context
The main window's preload exposes the full app API. `will-navigate` allows every `file://` and `http://localhost…` URL, even in the installed app, so a dropped or linked local HTML file or a local web server page would get that API. The IPC handler doesn't check the sender (review H2).

## Decision
- `isAppUrl(url)`: in development, the dev-server origin; in the installed app, the app's own `index.html` file URL (any hash).
- `will-navigate` and `will-redirect` prevent anything else. http(s) targets open in the default browser instead.
- The renderer cancels `dragover` and `drop` on `window`.
- The IPC handler rejects calls unless `event.senderFrame` is a main frame and `isAppUrl(senderFrame.url)`.

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Only block file drops | Minimal | localhost/file navigation still possible via links | Incomplete |
| Custom `app://` protocol | Strong origin isolation | Larger change to loading, CSP and updater paths | Not needed for this fix; could come later |

## Consequences
### Positive
- Only the app page can drive the API, defence in depth.
### Negative
- In-window links to other pages never navigate in place (they open in the browser), which is intended.
### Risks
- A wrong `isAppUrl` would block the app's own load. Covered by the E2E smoke test, which loads the built app.
