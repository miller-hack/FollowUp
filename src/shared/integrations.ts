// ---------------------------------------------------------------- Slack / Teams

export type IntegrationKind = 'slack_webhook' | 'slack_bot' | 'teams_webhook'

export const INTEGRATION_LABEL: Record<IntegrationKind, string> = {
  slack_webhook: 'Slack (incoming webhook)',
  slack_bot: 'Slack (app with bot token)',
  teams_webhook: 'Microsoft Teams (Workflows webhook)'
}

/** Slack messages with this reaction become tasks (bot integrations only). */
export interface SlackWatch {
  enabled: boolean
  /** reaction name without colons, e.g. "memo" */
  emoji: string
  list_id: string | null
}

export interface IntegrationConfig {
  /** slack_bot: channel id (C…) to post to and watch */
  channel?: string
  channel_name?: string
  /** forward FollowUp notifications (due dates, reminders, daily summary, automation notifications) */
  mirrorNotifications: boolean
  watch?: SlackWatch
}

export interface Integration {
  id: string
  kind: IntegrationKind
  name: string
  config: IntegrationConfig
  enabled: boolean
  /** webhook host, so the user can tell integrations apart without seeing the secret */
  target: string
  last_error: string | null
  last_used_at: string | null
  created_at: string
}

export interface IntegrationInput {
  kind: IntegrationKind
  name: string
  config: IntegrationConfig
  /** webhook URL or bot token; omitted on update to keep the stored one */
  secret?: string
}

/** A message sent to Slack / Teams. */
export interface OutgoingMessage {
  /** shown in bold; may be empty for plain messages */
  title: string
  body?: string
}

// ---------------------------------------------------------------- Google / Microsoft sign-in

export type OAuthProvider = 'google' | 'microsoft'

export interface OAuthClientStatus {
  clientId: string
  /** Google desktop clients also have a (non-confidential) secret */
  hasSecret: boolean
  /** the client id came with this build (FOLLOWUP_GOOGLE_CLIENT_ID / FOLLOWUP_MICROSOFT_CLIENT_ID) */
  builtIn: boolean
}

// ---------------------------------------------------------------- app updates

export interface UpdateStatus {
  state: 'dev' | 'unconfigured' | 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  current: string
  /** version being downloaded / ready to install */
  next?: string
  percent?: number
  error?: string
  checked_at?: string
  /** where updates come from (feed URL), for display */
  source?: string
}
