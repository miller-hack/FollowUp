// Builds the Windows installer.
//
//   npm run dist                                   installer without auto-update
//   FOLLOWUP_UPDATE_URL=https://… npm run dist     installer that updates itself from that folder
//
// Upload everything in dist/ (FollowUp-Setup-x.y.z.exe, its .blockmap and latest.yml) to the
// update folder to publish a release. Optional:
//   FOLLOWUP_VERSION=1.2.3      override the version from package.json
//   FOLLOWUP_OUT=dist-x         output folder (default dist)
//   FOLLOWUP_RELEASE_TEST=1     build under a separate identity (app id, name, data folder, updater
//                               cache, no shortcuts) so tests never touch an installed FollowUp (ADR-012)
//   CSC_LINK / CSC_KEY_PASSWORD code-signing certificate (see electron-builder.yml)
//   MAIN_VITE_GOOGLE_CLIENT_ID / MAIN_VITE_GOOGLE_CLIENT_SECRET / MAIN_VITE_MICROSOFT_CLIENT_ID
//                               built-in sign-in client IDs, so users don't have to set their own
import { spawnSync } from 'node:child_process'

const url = process.env.FOLLOWUP_UPDATE_URL?.trim()
const args = ['electron-builder', '--win', '--publish', 'never']
if (url) {
  const local = /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)
  if (!url.startsWith('https://') && !local) {
    console.error('FOLLOWUP_UPDATE_URL must be an https:// address (updates are executables).')
    process.exit(1)
  }
  args.push('-c.publish.provider=generic', `-c.publish.url=${url.endsWith('/') ? url : `${url}/`}`)
}
if (process.env.FOLLOWUP_VERSION) args.push(`-c.extraMetadata.version=${process.env.FOLLOWUP_VERSION}`)
if (process.env.FOLLOWUP_OUT) args.push(`-c.directories.output=${process.env.FOLLOWUP_OUT}`)
const TEST_ID = 'app.followup.releasetest'
const TEST_NAME = 'FollowUpReleaseTest'
const releaseTest = !!process.env.FOLLOWUP_RELEASE_TEST
if (releaseTest)
  args.push(
    `-c.appId=${TEST_ID}`,
    `-c.productName=${TEST_NAME}`,
    // the packaged package.json decides the default data folder and the updater cache
    `-c.extraMetadata.productName=${TEST_NAME}`,
    '-c.extraMetadata.name=followup-release-test',
    `-c.nsis.shortcutName=${TEST_NAME}`,
    `-c.nsis.uninstallDisplayName=${TEST_NAME}`,
    '-c.nsis.createDesktopShortcut=false',
    '-c.nsis.createStartMenuShortcut=false'
  )
if (!process.env.CSC_LINK) console.warn('Note: building an unsigned installer (set CSC_LINK / CSC_KEY_PASSWORD to sign it).')

const run = (cmd, a, env = process.env) => {
  const r = spawnSync(cmd, a, { stdio: 'inherit', shell: process.platform === 'win32', env })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
// the main process uses this as its Windows app id (ADR-009)
run('npx', ['electron-vite', 'build'], { ...process.env, MAIN_VITE_APP_ID: releaseTest ? TEST_ID : '' })
run('npx', args)
console.log(url ? `\nBuilt with updates from ${url}` : '\nBuilt without an update server (Settings → Updates can set one later).')
