# Changelog

All notable changes to FollowUp are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [semantic versioning](https://semver.org).

## [Unreleased]

### Fixed
- **New events no longer seem to vanish.** If an event you save starts outside the dates on screen (for example "New event" late on a Sunday, which starts at midnight on Monday), the calendar now moves to the event's date.

## [1.0.0] - 2026-10-18

The first public, open-source release.

### Added
- **Choice on first close.** The first time you close the window, FollowUp asks whether to keep running in the background (so reminders, timers, email sync, automations and follow-ups keep working) or to quit. It also explains how to reopen the app: the Start menu, the desktop icon or the tray icon. You can change the answer in Settings → Window & startup.
- **Smooth scrolling in long lists.** The List view draws only the rows on screen, so lists with thousands of tasks stay fast.
- **More tests and CI.**
  - Component tests for the screens.
  - A GitHub Actions pipeline on Windows: typecheck, tests, the end-to-end test and an installer build.
- **Automatic updates from GitHub.** Installed copies check this repository's releases, download a new version in the background and install it when you restart.
- **Documentation.**
  - A full user guide covering every feature, how it works behind the scenes, and example scenarios.
  - Developer documentation and design decision records.

### Changed
- **FollowUp always appears as "FollowUp".** It never shows up as "Electron" in the Start menu, notifications or the Apps list.
- **Faster start.** The window opens immediately; backup and maintenance run a few seconds later.
- **Smaller email storage.**
  - Pictures inside emails are stored once per account as files instead of inside the database.
  - Mail stored by older versions is converted once, after a fresh backup.
  - The database gives free space back to the disk.
  - Backups are capped at 2 GB, always keeping the newest 3.
- **Editor upgraded to Tiptap 3.**
- **License:** Apache 2.0.

### Fixed
- A FollowUp installed on the same PC can no longer be affected by the release test.
- The tray setting now explains that email sync and automations also need FollowUp running.

## [0.6.1] - 2026-10-16

Hardening release after a full code review.

### Security
- Email attachments are stored under safe names, with Mark of the Web. Programs, scripts and shortcuts from email are never launched; you get a warning and **Show in folder** instead.
- The main window only ever shows the app itself, and internal requests are answered only for that page.

### Fixed
- One unreadable message, calendar event or follow-up step no longer stops the rest of the sync or queue.
- An email is recorded as sent as soon as the server accepts it, so it's never sent twice. Compose can't double-send.
- Invalid dates and task structures are rejected with a clear message. A display error affects only one area of the screen, with **Try again**.
- Automations never auto-reply to auto-replies, mailing lists or robots, and email a recipient at most once per rule per day.
- Dialogs ask before discarding unsaved work.

### Changed
- New database indexes and daily cleanup. Attachment files are removed with their tasks. Export includes automations, templates, follow-ups and the local calendar, and never secrets.
- Mail and routing libraries upgraded; no critical or high advisories.

## [0.6.0] - 2026-10-16

The first complete version, built in six phases:
- **Phase 1, core:** spaces, folders, lists, statuses, tasks, subtasks, checklists, comments, attachments, dependencies, custom fields, tags, search, and the List, Board, Calendar and Gantt views.
- **Phase 2, planning:** sprints, time tracking, goals and key results, dashboards, reminders, notifications.
- **Phase 3, automations:** triggers, conditions, actions, templates, run history, the job queue.
- **Phase 4, email and calendar:** IMAP/SMTP accounts, the inbox, email to task, follow-up sequences, templates, CalDAV calendars.
- **Phase 5, AI:** the assistant (Claude, OpenAI, Ollama) with approval cards, triage, Quick add, summaries, weekly review.
- **Phase 6, integrations and release:** Slack and Teams, Sign in with Google/Microsoft, the Windows installer, auto-update, `.ics` export.

[Unreleased]: https://github.com/miller-hack/FollowUp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/miller-hack/FollowUp/releases/tag/v1.0.0
[0.6.1]: https://github.com/miller-hack/FollowUp/blob/main/docs/developer/project-history.md#20-hardening-release-061-full-code-review
[0.6.0]: https://github.com/miller-hack/FollowUp/blob/main/docs/developer/project-history.md#12-delivery-phases
