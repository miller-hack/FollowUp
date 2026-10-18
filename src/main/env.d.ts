/** Build-time defaults (set in .env or the environment when running `npm run dist`). */
interface ImportMetaEnv {
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string
  readonly MAIN_VITE_MICROSOFT_CLIENT_ID?: string
  /** Windows app id of a packaged build (matches electron-builder appId; release-test builds use their own) */
  readonly MAIN_VITE_APP_ID?: string
}
