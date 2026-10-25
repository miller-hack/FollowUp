# ADR-016: Clients — companies, people and their history

**Status:** Accepted · **Date:** 2026-10-26

## Context
The team deals with many people at the same client and vendor companies. They want an Excel-like table: company, then its people, with designation, phone and work email; who answers and who acts on their side; who owns the relationship on ours; and a complete record of every contact. That record covers emails, calls, WhatsApp chats, office visits, online meetings and exhibitions, including **which of their people** took part in each.

## Decision
- **Data:**
  - `companies`: name, email domains, type, stage, our owner, next action and due date, notes.
  - `people`: company, name, designation, phone, work email and other emails, "acts for them", our owner, next action, notes.
  - `crm_stages`: editable (Lead, Contacted, Meeting held, Proposal sent, Negotiation, Won, Lost, On hold).
  - `team_members`: our side, starting with the user.
  - `interactions`: call, chat, meeting with mode (in person / at their office / online), event, note; with time, duration, place or link, summary and next steps.
  - `interaction_people` and `interaction_members`: exactly who took part on each side.
- **Emails are not copied.** A company's or person's history merges interactions with mail-store messages from or to their addresses. "Responds" means they wrote in the last 90 days; "last contact" is the latest email or interaction.
- **The table:**
  - The company and stage cells span the company's people's rows.
  - Cells edit in place, and the columns are resizable (remembered).
  - Filters by stage, owner and type, plus search across names, emails, designations and phones.
  - A side panel shows the details, people and history, with "Log a call, meeting…". Logging can also create a task for the next step.
- **From email:** addresses exchanged with in the last 6 months that aren't clients yet, grouped by company domain. Public mailboxes stay individual. Our own domains, robots, lists and ignored addresses are skipped. The user confirms before anything is added.
- **Import/export:**
  - Import: `.xlsx` (read-excel-file) or `.csv` (built-in RFC 4180 parser), with a column mapping guessed from the headers and a preview. People are matched by email, so a re-import updates rather than duplicates. Limit: 5,000 rows.
  - Export: `.xlsx` (write-excel-file) with Clients and Interactions sheets, or `.csv`.
- **Elsewhere:** conversations show their client company and stage; follow-up drafts use the client context (ADR-015); AI tools `find_client` and `log_client_interaction` (the latter needs approval). Clients are part of the JSON export.

## Alternatives considered
| Alternative | Pros | Cons | Why not |
|---|---|---|---|
| Copy emails into interactions | One table | Duplicates, out of sync with the mailbox | The mail store is already the source |
| Contacts without companies | Simpler | The team thinks in companies with several people | Company → people matches the request |
| A full CRM integration (HubSpot, …) | Rich | Online service, accounts, cost; FollowUp is local-first | Out of scope |
| SheetJS for Excel | Popular | The npm build is old and has advisories | Smaller, maintained libraries |

## Consequences
- Two new runtime dependencies, both pinned and checked against the 14-day rule (ADR-006).
- Matching emails to people uses their stored addresses (`LIKE` on the JSON address lists). That's fast enough for thousands of messages; a dedicated address index can come later if needed.
- Tests: `tests/crm.test.ts` (validation, stages, team, history merge, suggestions, CSV/Excel round trip); the E2E test adds a client from email and logs a meeting.
