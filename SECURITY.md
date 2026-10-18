# Security policy

FollowUp handles email accounts, API keys and personal data, so security reports are taken seriously.

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x (latest) | Yes |
| Older | No: please update first |

## Reporting a vulnerability

**Please don't open a public issue for a security problem.** Report it privately:

1. Go to this repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the problem, how to reproduce it, and what an attacker could do with it.

Only the maintainer can see the report. You'll get a reply as soon as possible, usually within a week. Once a fix is released, the report can be made public and you'll be credited (unless you'd rather not be).

## What counts

Examples of problems worth reporting privately:
- an email, attachment, calendar event or Slack message that can run code, read local files or reach the app's internal API;
- a way to read stored passwords, API keys or OAuth tokens;
- an update that installs without being verified;
- anything that sends your data somewhere you didn't choose.

Ordinary bugs, crashes and feature requests belong in [public issues](https://github.com/miller-hack/FollowUp/issues/new/choose).

## How FollowUp protects your data

- All data stays on your PC, in `%APPDATA%\FollowUp`. There are no FollowUp servers and no telemetry.
- Passwords, API keys and tokens are encrypted with Windows DPAPI (Electron `safeStorage`). They are never sent to the window or included in exports.
- Email HTML is sanitised and shown in a sandboxed frame; remote images (tracking pixels) are blocked unless you allow them.
- Attachments are stored with Mark of the Web, and programs from email are never launched.
- The window runs with context isolation and a sandbox, and can only call a typed list of functions.
- AI providers only receive what a feature sends them, and the assistant asks before changing anything.

The full design is in [docs/developer/architecture.md](docs/developer/architecture.md#security-boundaries) and the [design decisions](docs/decisions/README.md).
