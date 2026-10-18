// Release test: the installer installs, and the installed app updates itself.
//   1. build installers for version A and B, both pointing at a local update server
//   2. install A silently into a temp folder (per-user, no admin)
//   3. launch it, let it find + download B from the local server, click "Restart and update"
//   4. wait until the installed exe is version B, then uninstall and clean up
// Usage: npm run test:update            (takes a few minutes: two full builds)
//
// Both builds use the release-test identity (FOLLOWUP_RELEASE_TEST, ADR-012): their own app id,
// product name, data folder and updater cache, and no shortcuts. A FollowUp installed on this PC
// is never replaced, uninstalled or opened by the test.
import { _electron as electron } from 'playwright-core'
import { spawnSync, execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const PRODUCT = 'FollowUpReleaseTest'
const A = '0.9.0'
const B = JSON.parse(readFileSync('package.json', 'utf8')).version
const root = resolve('.')
const outA = join(root, 'dist-update', 'a')
const outB = join(root, 'dist-update', 'b')
const work = mkdtempSync(join(tmpdir(), 'followup-update-'))
const installDir = join(work, 'app')
const dataDir = join(work, 'data')
const appData = join(process.env.APPDATA ?? '', PRODUCT)
const appDataExisted = existsSync(appData)

// ---- local update server serving build B
const server = createServer((req, res) => {
  const file = join(outB, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, ''))
  if (!file.startsWith(outB) || !existsSync(file) || statSync(file).isDirectory()) return res.writeHead(404).end()
  res.writeHead(200, { 'Content-Length': statSync(file).size })
  createReadStream(file).pipe(res)
})
// fixed port: the URL is baked into the installers, so REUSE_BUILDS=1 can skip rebuilding
await new Promise((r) => server.listen(47231, '127.0.0.1', r))
const url = `http://127.0.0.1:${server.address().port}/`

const step = (msg) => console.log(`\n== ${msg}`)
const fail = (msg) => {
  throw new Error(msg)
}
const fileVersion = (exe) =>
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${exe}').VersionInfo.ProductVersion`], { encoding: 'utf8' })
    .trim()
    .replace(/^(\d+\.\d+\.\d+)\.0$/, '$1') // Windows reports 4-part versions
const killInstalled = () =>
  spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-Process ${PRODUCT} -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${installDir}*' } | Stop-Process -Force`])

function build(version, out) {
  rmSync(out, { recursive: true, force: true })
  const r = spawnSync('node', ['scripts/dist.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, FOLLOWUP_RELEASE_TEST: '1', FOLLOWUP_UPDATE_URL: url, FOLLOWUP_VERSION: version, FOLLOWUP_OUT: out }
  })
  if (r.status !== 0) fail(`build ${version} failed`)
}

let ok = false
try {
  step(`build ${A} and ${B}`)
  // reuse only builds made with the test identity
  const have = (out, v) => existsSync(join(out, `FollowUp-Setup-${v}.exe`)) && existsSync(join(out, 'win-unpacked', `${PRODUCT}.exe`))
  if (process.env.REUSE_BUILDS && have(outA, A) && have(outB, B)) console.log('reusing existing builds')
  else {
    build(A, outA)
    build(B, outB)
  }
  if (!existsSync(join(outB, 'latest.yml'))) fail('latest.yml was not generated')

  step(`install ${A} silently into ${installDir}`)
  const setup = join(outA, `FollowUp-Setup-${A}.exe`)
  const inst = spawnSync(setup, ['/S', `/D=${installDir}`], { stdio: 'inherit' })
  if (inst.status !== 0) fail(`installer exited with ${inst.status}`)
  const exe = join(installDir, `${PRODUCT}.exe`)
  if (!existsSync(exe)) fail(`${PRODUCT}.exe was not installed`)
  if (fileVersion(exe) !== A) fail(`installed version is ${fileVersion(exe)}, expected ${A}`)
  console.log(`installed ${fileVersion(exe)}`)

  step('launch the installed app and update from the local server')
  const app = await electron.launch({ executablePath: exe, env: { ...process.env, FOLLOWUP_DATA_DIR: dataDir } })
  const page = await app.firstWindow()
  if ((await app.evaluate(({ app: a }) => a.getVersion())) !== A) fail('running version mismatch')
  await page.locator('nav').getByText('Getting Started').waitFor({ timeout: 30_000 })
  await page.getByRole('link', { name: 'Settings' }).click()
  const updates = page.locator('#updates')
  await updates.scrollIntoViewIfNeeded()
  await updates.getByText(`FollowUp ${A}`).waitFor()
  if (await updates.getByRole('button', { name: 'Check for updates' }).isEnabled()) await updates.getByRole('button', { name: 'Check for updates' }).click()
  await updates.getByRole('button', { name: 'Restart and update' }).waitFor({ timeout: 180_000 })
  console.log(await updates.getByRole('status').innerText())
  await page.screenshot({ path: join(work, 'update-ready.png') })
  const exited = new Promise((r) => app.process().once('exit', r))
  await updates.getByRole('button', { name: 'Restart and update' }).click()
  await Promise.race([exited, new Promise((r) => setTimeout(r, 30_000))])

  step(`wait for ${B} to be installed`)
  const end = Date.now() + 180_000
  let v = ''
  for (;;) {
    try {
      v = fileVersion(exe)
    } catch {
      v = '(being replaced)'
    }
    if (v === B) break
    if (Date.now() > end) fail(`still version ${v} after 3 minutes`)
    await new Promise((r) => setTimeout(r, 2000))
  }
  console.log(`updated to ${v}`)
  // the installer restarts the app after updating
  const relaunchEnd = Date.now() + 30_000
  let running = false
  while (Date.now() < relaunchEnd && !running) {
    running = spawnSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-Process ${PRODUCT} -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${installDir}*' }).Count`], { encoding: 'utf8' }).stdout.trim() !== '0'
    if (!running) await new Promise((r) => setTimeout(r, 1000))
  }
  console.log(running ? 'new version relaunched' : 'warning: the app did not relaunch by itself')
  ok = true
} catch (e) {
  console.error(`\nFAILED: ${e.message}`)
} finally {
  step('clean up')
  killInstalled()
  const uninstaller = existsSync(installDir) ? readdirSync(installDir).find((f) => /^Uninstall .*\.exe$/i.test(f)) : null
  if (uninstaller) spawnSync(join(installDir, uninstaller), ['/S'], { stdio: 'inherit' })
  // the uninstaller copies itself to %TEMP% and returns at once; give it time to finish
  for (let i = 0; i < 30 && existsSync(join(installDir, `${PRODUCT}.exe`)); i++) await new Promise((r) => setTimeout(r, 1000))
  await new Promise((r) => setTimeout(r, 2000))
  rmSync(work, { recursive: true, force: true })
  // if the relaunched app created the default data folder, remove it (never touch existing data)
  if (!appDataExisted && existsSync(appData)) rmSync(appData, { recursive: true, force: true })
  // a notification from the test app makes Windows/Electron add a Start-menu shortcut for its
  // app id; remove it only if it points into this test's install folder
  spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `$p = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\${PRODUCT}.lnk'; ` +
      `if (Test-Path $p) { $t = (New-Object -ComObject WScript.Shell).CreateShortcut($p).TargetPath; if ($t -like '${installDir}*') { Remove-Item -LiteralPath $p -Force } }`
  ])
  rmSync(join(process.env.LOCALAPPDATA ?? '', 'followup-release-test-updater'), { recursive: true, force: true })
  server.close()
  console.log(ok ? '\nUpdate test passed.' : '\nUpdate test failed.')
  process.exit(ok ? 0 : 1)
}
