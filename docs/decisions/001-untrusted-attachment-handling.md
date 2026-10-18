# ADR-001: Untrusted email attachment storage and opening

**Status:** Accepted · **Date:** 2026-10-16 · **Feature:** code-review-hardening

## Context
Attachments from any sender are written under their original filename and opened with `shell.openPath` (double-click semantics). Executables and scripts run on one click. Files carry no Mark of the Web, so SmartScreen and Office Protected View don't treat them as downloaded. Crafted names (`..`, `.`, empty) make the write fail, and duplicate names overwrite each other (review H1, H3).

## Decision
1. Store every attachment in its own folder, `mail/<account>/<messageRow>/<attachmentRow>/<safeName>`. `safeName` removes control and reserved characters, trailing dots and spaces, and Windows device names. It falls back to `attachment` and caps the name at 120 characters while keeping the extension.
2. Write `Zone.Identifier` (ZoneId=3) after each write. This is best effort: only NTFS supports it.
3. `isDangerousFile` covers executables, scripts, shortcuts, installers, disk images and HTML-application/help files. Dangerous files are never launched: a native warning offers **Show in folder** (the default) or Cancel. Everything else opens normally, now with Mark of the Web.

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Block dangerous types entirely | Simplest | User can't reach a legitimate installer they were sent | Show in folder keeps access behind Windows' own warnings |
| Always "Show in folder", never open | Safest | Every PDF needs two steps | Too much friction for safe types |
| Keep names, only add Mark of the Web | Small change | Scripts still run from the app; name bugs remain | Doesn't fix H3 |

## Consequences
### Positive
- No one-click execution; Windows' native protections apply; no name collisions or path tricks.
### Negative
- Dangerous files take one extra step.
### Risks
- On non-NTFS volumes the Mark of the Web write fails silently. Mitigated because the open path still blocks dangerous types.

## Dependencies
Existing rows keep their old `stored_path` (they still open, behind the same gate). Only new attachments use the new layout.
