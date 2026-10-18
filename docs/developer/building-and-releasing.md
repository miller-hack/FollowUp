# Building and releasing

## Development mode

```bash
npm run dev
```

This runs electron-vite with hot reload: changes to the UI show immediately, and changes to the main process restart the app.

A development run keeps its **own identity** (ADR-009):
- its Windows app id ends in `.dev`;
- it shows notifications only inside the app, never as Windows toasts;

so it can never register an "Electron" entry in the Start menu under FollowUp's name. It uses the same data folder as the installed app (`%APPDATA%\FollowUp`) unless you set `FOLLOWUP_DATA_DIR`. To use a separate folder:

```powershell
$env:FOLLOWUP_DATA_DIR = "C:\temp\followup-dev"; npm run dev
```

## Building the installer

```bash
npm run dist
```

`scripts/dist.mjs` runs `electron-vite build` and then electron-builder. The result in `dist/`:

| File | Purpose |
|---|---|
| `FollowUp-Setup-x.y.z.exe` | The installer users download |
| `FollowUp-Setup-x.y.z.exe.blockmap` | Lets auto-update download only the changed parts |
| `latest.yml` | Tells installed copies which version is current (with its SHA-512) |

**The installer** (NSIS, configured in `electron-builder.yml`):
- installs per user, so no admin rights are needed;
- lets the user choose the folder;
- creates Start-menu and desktop shortcuts named **FollowUp**;
- keeps the user's data on uninstall.

**Build options** (environment variables):

| Variable | Effect |
|---|---|
| `FOLLOWUP_UPDATE_URL` | Builds your own update server into the installer, instead of GitHub releases (see [Auto-update](#auto-update)) |
| `FOLLOWUP_VERSION` | Overrides the version from `package.json` |
| `FOLLOWUP_OUT` | Output folder (default `dist`) |
| `FOLLOWUP_RELEASE_TEST` | Builds under the isolated release-test identity (used by `npm run test:update`) |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Code-signing certificate (see [Code signing](#code-signing)) |
| `MAIN_VITE_GOOGLE_CLIENT_ID`, `MAIN_VITE_GOOGLE_CLIENT_SECRET`, `MAIN_VITE_MICROSOFT_CLIENT_ID` | Built-in OAuth client IDs, so users don't need to create their own for "Sign in with Google/Microsoft" |

**The icon** is generated from code by `npm run icon` into `build/icon.png` and `build/icon.ico`. Replace those two files to rebrand (see [Customizing](customizing.md)).

## Versioning

FollowUp uses [semantic versioning](https://semver.org): `MAJOR.MINOR.PATCH`.
- **PATCH** for bug fixes;
- **MINOR** for new features that keep existing data and settings working;
- **MAJOR** for changes that break something for users.

The version lives in `package.json`. Database changes are always forward migrations, so any newer version opens an older database (see [Data model](data-model.md#migrations)).

## Release checklist

1. Update `CHANGELOG.md` and the version in `package.json`.
2. Run the checks:
   ```bash
   npm run typecheck
   ```
   ```bash
   npm test
   ```
   ```bash
   npm run e2e
   ```
   ```bash
   npm run test:update
   ```
3. Build the installer with `npm run dist` (signed, if you have a certificate).
4. Record its hash for the release notes:
   ```powershell
   Get-FileHash dist\FollowUp-Setup-1.0.0.exe -Algorithm SHA256
   ```
5. Commit, tag and push:
   ```bash
   git tag v1.0.0
   ```
   ```bash
   git push origin main --tags
   ```
6. On GitHub, create a **Release** from the tag. Paste the changelog entry and the SHA-256 hash, and attach **all three** files from `dist/`: `FollowUp-Setup-x.y.z.exe`, `FollowUp-Setup-x.y.z.exe.blockmap` and `latest.yml`. Installed copies update from these (see below), so don't rename them.
7. Publish it as a normal release, not a draft or pre-release: installed copies only see the latest published release.

## Auto-update

Installed copies can update themselves using [electron-updater](https://www.electron.build/auto-update) (`src/main/services/updater.ts`).

**Where updates come from.** The installer has an update source built in (`resources\app-update.yml`):
- **By default: the project's GitHub releases.** `package.json` names the repository, and electron-builder turns that into a `github` update source. Settings → Updates shows it as *built in: GitHub releases of owner/repo*. A fork that changes `repository` in `package.json` automatically updates from its own releases.
- **Your own server instead:** build with `FOLLOWUP_UPDATE_URL` (see below). That's any HTTPS folder of static files (a web server, an S3 or R2 bucket…) holding `latest.yml`, the installer and its `.blockmap`.
- **Per user:** **Settings → Updates → Update server** overrides the built-in source.

**How it works:**
1. About 15 seconds after start-up, and then every 6 hours (if automatic checks are on), the app looks up the latest release, downloads its `latest.yml` and compares versions.
2. A newer version is downloaded in the background. Its SHA-512 is checked against `latest.yml`; a mismatch discards the download.
3. When ready, **Restart to update** appears in the sidebar, the tray menu and Settings. Otherwise the update installs the next time the app quits.

**Rules:**
- Only `https://` addresses are accepted (`http://localhost` and `127.0.0.1` are allowed for testing), because updates are programs.
- Development runs never check for updates.
- If there's no release yet, or a release lacks `latest.yml`, Settings → Updates shows "No release was found on the update server". Nothing else is affected.
- GitHub allows about 60 checks per hour from one internet address without signing in, which is plenty at one check every 6 hours.

**Publishing an update on GitHub:** follow the [release checklist](#release-checklist). Copies installed from any earlier release pick up the new one within 6 hours, or straight away with **Check for updates**.

**Publishing an update on your own server:**

```powershell
$env:FOLLOWUP_UPDATE_URL = "https://downloads.example.com/followup/"; npm run dist
```

Then upload everything in `dist/` to that folder, replacing the old `latest.yml`. Users already on a build with that address update automatically. For other users, enter the address in Settings → Updates.
## Code signing

Without a signature, Windows SmartScreen shows "Windows protected your PC" the first time someone runs the installer. Users can click **More info → Run anyway**, but a signature removes the warning and proves who built the file.

**Options:**
- **A code-signing certificate** (`.pfx`) from a certificate authority. Set `CSC_LINK` (a path or https URL to the file) and `CSC_KEY_PASSWORD` before `npm run dist`. In CI, add them as repository secrets with those names: the workflow passes them through already.
- **Azure Trusted Signing.** Add `azureSignOptions` to `electron-builder.yml` (see the electron-builder code-signing documentation).

Once signed, set `signtoolOptions.publisherName` in `electron-builder.yml` to the certificate's name. Updates are then installed only when they carry the same signature.

## Continuous integration

`.github/workflows/ci.yml` runs on Windows for every push to `main` and every pull request:
1. `npm ci`;
2. typecheck;
3. unit and component tests;
4. the end-to-end test (screenshots are uploaded if it fails);
5. `npm run dist`, signed if the `CSC_LINK` / `CSC_KEY_PASSWORD` secrets exist.

The installer, `.blockmap` and `latest.yml` are kept as the **FollowUp-installer** artifact for 14 days: download it from the run's summary page to try a build without compiling.

**Security of the workflow:**
- It has read-only repository permissions.
- Checkout doesn't keep the token.
- Every action is pinned to a full commit SHA, with the release named in a comment.

## Dependencies

- **Versions:** most libraries are pinned to exact versions in `package.json`; `package-lock.json` is committed, and `npm ci` installs exactly what's locked.
- **Age rule:** new versions are adopted only once they are at least 14 days old, to avoid freshly compromised packages (ADR-006).
- **Audit:** `npm audit` must report no high or critical advisories before a release.
- **Install scripts:** npm 11 asks once to approve install scripts. Only `electron`, `esbuild` and `electron-winstaller` need them.
