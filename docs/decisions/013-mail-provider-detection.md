# ADR-013: Find mail settings from the email address

**Status:** Accepted · **Date:** 2026-10-24

## Context
Real users couldn't add accounts in 1.0.0. The servers worked; the form asked for the wrong things:
- a provider list first, so a Google Workspace address on a university domain was entered as "Other" with a made-up `mail.<domain>` host (ENOTFOUND);
- an "App password" label even for own hosting, where the mailbox password is right;
- a free-text username that accepted a person's name (`syed aban`);
- no check that the address contained an `@`.

## Decision
Adding an account starts from the address only. The main process (`services/mail/detect.ts`, API `getMailSettingsFor`) tries, each step time-boxed:
1. well-known consumer domains;
2. MX records, which reveal Google Workspace, Microsoft 365, Zoho, Fastmail, iCloud and Yahoo behind any domain;
3. Thunderbird's ISPDB (by domain, then by the MX host's base domain), then the domain's own `autoconfig.<domain>` file, preferring implicit TLS, then STARTTLS, never plain text;
4. TCP connects to `mail.<domain>`, `imap.<domain>` and the MX host on 993, with SMTP on 465 or 587.

The result says which sign-in fits: OAuth, an app password, the mailbox password, or "sign-in only" for Microsoft. The dialog shows just that. The connection is tested before the account is saved ("Add anyway" overrides), and usernames with spaces are refused. Sign-in errors name the right kind of password for the provider.

Only the domain leaves the PC during detection: DNS queries, HTTPS GETs that name the domain, and bare TCP connects without credentials. Null MX records are ignored, so an empty host can never mean "this PC".

## Alternatives considered
| Alternative | Pros | Cons | Why not |
|---|---|---|---|
| Better help text on the old form | Tiny change | Users still have to know their provider and hosts | Didn't address the actual failures |
| Mozilla ISPDB only | Simple, well maintained | Doesn't know Google Workspace / Microsoft 365 custom domains, or small hosts | MX covers the most common business case |
| Try logging in to guessed servers | Finds more | Sends the password to hosts we only guessed | Never send credentials while searching |

## Consequences
- Most addresses need no server knowledge at all. Unknown ones fall back to the manual fields, with an explanation.
- Detection adds up to a few seconds for unknown domains, and needs DNS and HTTPS access.
- Tests cover every path with injected DNS/HTTP/TCP functions (`tests/detect.test.ts`). The E2E test covers the dialog.
