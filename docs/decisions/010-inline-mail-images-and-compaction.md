# ADR-010: Inline mail images on disk, database compaction, backup cap

**Status:** Accepted · **Date:** 2026-10-17 · **Feature:** release-1-0

## Context
- `parseRaw` replaced every `cid:` image (up to 512 KB each) with a base64 `data:` URI inside `mail_messages.body_html`.
- On a real installation 105 newsletters average 2 MB of HTML each (up to 9 MB). 201 MB of their 206 MB is base64 images, many identical across messages.
- An earlier, larger mailbox left 850 MB of free pages. SQLite never returns them without VACUUM.
- The daily backup keeps 14 copies, so a large database multiplies.

## Decision
1. **Inline images become files:**
   - Images referenced by `cid:` are written to `mail/<account>/inline/<sha256>.<ext>`: content-addressed, written once and shared by every message that uses them.
   - Each gets a `mail_attachments` row with `inline = 1` and `content_id`.
   - `body_html` keeps the `cid:` reference.
   - Migration 8 adds `mail_attachments.inline INTEGER NOT NULL DEFAULT 0` and `content_id TEXT`.
2. **Resolve on read:**
   - `getThread` replaces `cid:<id>` with a `data:` URI read from the file, only for the thread being shown. At most 20 MB is inlined per message; anything over that is left as a broken image.
   - The email iframe's CSP (`img-src data:`) is unchanged.
   - Inline rows are hidden from attachment lists and don't set `has_attachments`.
3. **Legacy rewrite:**
   - Maintenance converts existing bodies once, in batches: each `data:image/*;base64` URI of 4 KB or more becomes a content-addressed file plus a `cid:fu-<hash16>` reference.
   - A `maintenance:inline-images-v1` settings flag marks completion.
   - It's idempotent: a message is updated only when something changed, and file and row inserts are existence-checked.
4. **Compaction:**
   - If `auto_vacuum` isn't INCREMENTAL, set it and run one full `VACUUM`. Run `PRAGMA incremental_vacuum` afterwards in daily maintenance.
   - `wal_checkpoint(TRUNCATE)` follows both.
5. **Backups:**
   - Keep up to 14. Beyond the newest 3, drop the oldest once their total exceeds 2 GB.
6. **Cleanup:**
   - Inline files no longer referenced by any row are removed by maintenance (accounts are already removed wholesale).

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Custom `followup-mail://` protocol serving images to the iframe | No base64 over IPC | New privileged scheme, CSP and sandbox changes; more surface (ADR-002) | The thread payload is what we send today; keep the security model |
| Store images as BLOBs in a separate table, deduplicated | One store | Still bloats the DB and backups | Files are already how attachments work |
| Strip inline images | Smallest | Breaks how mail looks | Unacceptable UX |
| Periodic full VACUUM only | Simple | Rewrites the whole DB each time and blocks | Incremental reclaim is cheap after one VACUUM |

## Consequences
### Positive
- That database goes from 1.1 GB to about 10 MB. Backups shrink accordingly, and identical images are stored once.
### Negative
- Opening a thread reads image files (cheap; local disk).
- An inline image is missing if its file is deleted by hand.
### Risks
- **Migration bug corrupts bodies.** Mitigations:
  - a backup is taken first (ADR-009);
  - the rewrite only replaces exact URI matches;
  - unit tests cover round-trip rendering.
- **Full VACUUM time.** It's proportional to live data (about 10 MB after the rewrite) and runs once, after the window is shown.
