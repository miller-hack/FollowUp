# ADR-012: CI pipeline, release-test isolation, build-chain advisories

**Status:** Accepted · **Date:** 2026-10-17 · **Feature:** release-1-0

## Context
- **No CI.** Nothing checks the project automatically.
- **Release test hazard.** `npm run test:update` installs real builds with the production `appId`, product name, shortcuts, uninstall key, updater cache and default data folder. On a PC where FollowUp is installed, it could replace or remove the user's shortcuts and uninstall entry, or open the user's real data after the installer relaunches the app.
- **Build-chain advisory.** The remaining moderate advisories come from `electron-builder → @electron/get → global-agent 3 → roarr 2 → sprintf-js ≤ 1.1.3`.

## Decision
1. **`.github/workflows/ci.yml`:**
   - Runs on push and PR, on `windows-latest` with Node 24.
   - Steps: `npm ci`, typecheck, unit + renderer tests, E2E smoke, then an unsigned `npm run dist` uploaded as an artifact.
   - Third-party actions are pinned to full commit SHAs. The workflow has `permissions: contents: read`.
2. **`FOLLOWUP_RELEASE_TEST=1` in `scripts/dist.mjs`** builds under a separate identity:
   - `appId app.followup.releasetest`
   - `productName FollowUpReleaseTest` (also in the packaged `package.json`, so the default data folder differs)
   - package name `followup-release-test` (separate updater cache)
   - no desktop or Start-menu shortcuts

   `tests/release/update-test.mjs` uses it and refuses to run without it.
3. **Override:** `@electron/get` uses `global-agent 4.1.3`, which has no roarr dependency and the same `bootstrap()` API. It's only loaded when a download proxy is configured.

## Alternatives Considered
| Alternative | Pros | Cons | Why Not |
|---|---|---|---|
| Run the release test only in CI | No local risk | Maintainers can't verify locally; CI has no update server | Isolation makes it safe in both |
| Upgrade electron-builder | Official | 26.17 still pins `@electron/get ^3` | Doesn't remove the chain |
| Self-hosted runner | Faster | Maintenance | `windows-latest` is enough |

## Consequences
### Positive
- `npm audit` is clean, automated checks run on every push, and the release test can't touch the real install.
### Negative
- **E2E on CI.** It needs a desktop session. GitHub's Windows runners provide one, but runs take about 10 minutes.
### Risks
- **`global-agent` 4 differences.** The only call site is guarded by `ELECTRON_GET_USE_PROXY` and unused here.
- **Code signing (T3) still open.** It requires a certificate bought in the publisher's name. The workflow and `electron-builder.yml` document where `CSC_LINK`/`CSC_KEY_PASSWORD` go.
