# ADR-006: Upgrade shipped mail and router libraries; supply-chain rule

**Status:** Accepted · **Date:** 2026-10-16 · **Feature:** code-review-hardening

## Context
Libraries bundled into the app have published advisories (H6): nodemailer <=10.0.5 (several high), mailparser <3.9.3 and linkify-it <=5.0.1, socks/ip-address via imapflow 1.x, and react-router <7.18.0. Test tooling also has advisories: vitest (critical <3.2.6; moderate <4.1.11) and smtp-server.

## Decision
Pin versions published at least 14 days ago that cover the advisories:
- nodemailer 10.0.13 (+ @types/nodemailer 8.0.2)
- mailparser 3.9.33
- imapflow 2.2.1
- react-router-dom 7.18.4
- smtp-server 3.19.16
- vitest 4.1.11

Validate with the full mail/phase-6 unit suites (real protocol servers) and the E2E smoke test.

Accepted residual (dev-only, not shipped):
- hoodiecrow-imap 2.x (optimist/minimist; the fixed 3.3.1 is younger than 14 days)
- the electron-builder transitive chain (build tool)

Deferred: Tiptap 3 (T1).

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| `npm audit fix --force` | One command | Pulls the newest releases (supply-chain risk) and odd downgrades (electron-builder 26.5.0) | Uncontrolled |
| Stay on nodemailer 6 and patch | No major bump | Parser-level advisories can't be patched locally | Unmaintainable |

## Consequences
### Positive
- No known advisories in shipped mail or router code.
### Negative
- Major bumps (nodemailer 6→10, imapflow 1→2, vitest 3→4) may change behaviour.
### Risks
- API changes surface as test failures. If one can't be made compatible, fall back to the newest compatible patched release and record it here.
