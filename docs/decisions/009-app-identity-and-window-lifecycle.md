# ADR-009: App identity and window lifecycle

**Status:** Accepted · **Date:** 2026-10-17 · **Feature:** release-1-0

## Context
- Windows ties taskbar grouping, pins and toast attribution to the AppUserModelID (AUMID).
- Our dev and E2E runs used the production AUMID `app.followup.desktop` and showed toasts from `node_modules\electron\dist\electron.exe`. Electron then created `Start Menu\Programs\Electron.lnk` with that AUMID.
- On a real installation this shortcut competed with the installed FollowUp, so FollowUp could appear as "Electron" and launching that entry opened the Electron demo window.
- Separately, closing the window hides it to the tray without explaining how to get back. Windows 11 also hides new tray icons in the overflow.
- Finally, startup ran backup and maintenance before creating the window. A large database delayed the first paint by seconds.

## Decision
1. **AUMID per build:**
   - Packaged builds use `app.followup.desktop`, matching `appId` and the NSIS shortcut.
   - Unpackaged runs (dev, E2E) use `app.followup.desktop.dev`.
   - OS toasts are shown only by the packaged app, so dev runs never create shortcuts. In-app notifications are unchanged.
2. **First close asks:**
   - The first time the window is closed (not quitting), a native dialog offers "Keep running in the background", "Quit FollowUp" or "Cancel". It explains how to reopen and has a "Don't ask me again" checkbox, ticked by default.
   - The answer sets `closeToTray`. `closeAsked` records that the user chose, so the dialog won't return.
   - Settings keeps the toggle. A re-entrancy guard ignores further closes while the dialog is open.
3. **Reopen paths:**
   - The Start menu or desktop shortcut starts a second instance, whose `second-instance` event shows and focuses the window (Chromium grants foreground rights).
   - The tray icon also reopens it. The balloon shown on hide names these paths.
4. **Fast first paint:**
   - `whenReady`: open DB → seed → settings → IPC → window → tray → scheduler.
   - Backup, then maintenance, then compaction run 3 s later. The backup runs first so the one-time data migrations always have a fresh copy.

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Default `closeToTray: false` (X quits) | Familiar | Reminders, timers and follow-ups silently stop; changes behaviour for existing users | Users rely on reminders; asking once is clearer |
| Keep the AUMID, delete stray shortcuts at startup | No code-path split | Dev runs would keep recreating it; touching Start menu files from the app is intrusive | Fix the cause, not the symptom |
| Run housekeeping in a worker thread | No main-thread blocking at all | `node:sqlite` handle can't be shared; a second connection complicates VACUUM | A 3 s deferral is enough; the operations are short after compaction |

## Consequences
### Positive
- One identity per channel. Dev never pollutes the Start menu. Users are told exactly how the app behaves on close and how to come back.
- The window appears immediately.
### Negative
- Notifications can't be tested from dev runs; they need the packaged build or the release test.
- One extra dialog on first close.
### Risks
- Existing installs have `closeAsked` unset, so they see the dialog once. That's intended.
- E2E closes via `app.quit()` (`before-quit` sets quitting), so the dialog never blocks automation.
