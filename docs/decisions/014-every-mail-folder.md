# ADR-014: Every server folder, with message locations

**Status:** Accepted · **Date:** 2026-10-26

## Context
Up to 1.0, FollowUp synced only INBOX and Sent. Users asked for Drafts, Spam, Archive, Trash and their own folders, plus the usual actions (archive, spam / not spam, delete, restore, move). On Gmail one message appears in several folders (labels, All Mail), and on every server a message moved elsewhere gets a new UID.

## Decision
1. **Folders:** each account's selectable folders are kept in `mail_folders`, with a **role**: inbox, sent, drafts, spam, trash, archive, all, or none for the user's own folders. The role comes from IMAP SPECIAL-USE, then from imapflow's name matching, then from FollowUp's own name rules. Gmail's Starred and Important views are skipped, since they only duplicate mail.
2. **Locations:** a message is stored once per account, keyed by Message-ID. `mail_locations (message_id, folder, uid)` records every folder it is in.
3. **Envelope-first sync:** for new UIDs, FollowUp first fetches only the envelope (UID, flags, Message-ID). Known messages just gain a location; only unknown ones are downloaded. Gmail's All Mail and labels therefore cost no extra downloads.
4. **Deleted elsewhere:** per folder, the current UID list is compared with the stored locations. Vanished locations are dropped. A message left with no location at all was deleted on the server and is removed locally, along with an empty conversation.
5. **Moves:** the local view changes at once (a placeholder location with UID −1). The server MOVE then runs as a retried job, followed by a sync that records the real UID. If the server refuses, the placeholder is removed and both folders are rescanned.
6. **Deleting for good:** only conversations whose messages are all in Spam or Trash can be deleted permanently, with a confirmation.
7. **Drafts:** "Save draft" APPENDs to the server's Drafts folder (`\Draft`) and keeps a local copy (`is_draft = 1`). Saving again replaces the previous version. Sending or discarding hides the draft immediately (`is_draft = 2`); it is deleted locally only after the server deleted it, so a sync in between can't bring it back. Drafts never count as sent mail or as "our reply".
8. **Inbox flag:** `is_inbox` follows the server (a location in the inbox-role folder). "Done" stays FollowUp's own triage flag.
9. **Upgrade:** migration 9 copies 1.0's INBOX/Sent positions into locations, and the first 1.1 sync carries over their UIDVALIDITY and last UID, so nothing is downloaded twice.

## Alternatives considered
| Alternative | Pros | Cons | Why not |
|---|---|---|---|
| One row per message per folder | Simple sync | Gmail stores everything twice or three times; threads show duplicates | Storage and confusing threads |
| Gmail API / X-GM-LABELS | Exact labels | Gmail-only; FollowUp works with any IMAP server | One model for every provider |
| Download everything, dedupe after | Simple | Downloads all of All Mail again | Bandwidth on large mailboxes |

## Consequences
- Every folder is browsable, and actions behave like a normal mail client, on the server.
- The first 1.1 sync imports up to 500 recent messages (within the account's history window) from each folder it hasn't synced before.
- Tests: `tests/followup.test.ts` covers folder roles, moves, deletion elsewhere, delete forever and drafts against an in-memory IMAP server.
