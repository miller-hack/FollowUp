import type { EmailCategory } from './ai'
import type { OAuthProvider } from './integrations'

// ---------------------------------------------------------------- accounts

export interface ServerConfig {
  host: string
  port: number
  /** true = implicit TLS (993/465); false = plain connection upgraded with STARTTLS when offered */
  secure: boolean
  user: string
}

export interface MailAccountConfig {
  imap: ServerConfig
  smtp: ServerConfig
  /** days of history imported on first sync */
  syncDays: number
  /** save sent mail to the Sent folder over IMAP (Gmail does this itself) */
  appendSent: boolean
  preset?: string
  /** signed in with Google / Microsoft instead of an app password */
  oauth?: OAuthProvider
}

export interface CalDavConfig {
  url: string
  user: string
  oauth?: OAuthProvider
}

export type AccountKind = 'mail' | 'caldav'

export interface Account {
  id: string
  kind: AccountKind
  name: string
  email: string
  config: MailAccountConfig | CalDavConfig
  enabled: boolean
  last_sync_at: string | null
  last_error: string | null
  created_at: string
}

export interface AccountInput {
  kind: AccountKind
  name: string
  email: string
  config: MailAccountConfig | CalDavConfig
  /** app password; omitted on update to keep the stored one */
  password?: string
}

/** IMAP/SMTP settings worked out from an email address (Settings → Add email account). */
export interface DetectedMailSettings {
  /** MAIL_PRESETS id ('custom' for anything else) */
  preset: string
  /** what was recognised, e.g. "Google Workspace" or "Mail server mail.example.com" */
  label: string
  /** how it was found */
  source: 'domain' | 'mx' | 'autoconfig' | 'guess'
  /** the provider's own sign-in works for this address */
  oauth: OAuthProvider | null
  imap: Omit<ServerConfig, 'user'>
  smtp: Omit<ServerConfig, 'user'>
  appendSent: boolean
  /** 'app': an app password from the provider; 'normal': the mailbox password; 'none': only sign-in works */
  passwordKind: 'app' | 'normal' | 'none'
  /** the login name: the full address, or only the part before @ */
  username: 'email' | 'local'
  help: string
}

export interface MailPreset {
  id: string
  label: string
  imap: Omit<ServerConfig, 'user'>
  smtp: Omit<ServerConfig, 'user'>
  appendSent: boolean
  caldav?: string
  help: string
}

export const MAIL_PRESETS: MailPreset[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    appendSent: false,
    help: 'Turn on 2-Step Verification, then create an app password at myaccount.google.com/apppasswords. IMAP must be enabled in Gmail settings. Easier: use “Sign in with Google”, which needs no app password and adds Google Calendar too.'
  },
  {
    id: 'icloud',
    label: 'iCloud Mail',
    imap: { host: 'imap.mail.me.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.me.com', port: 587, secure: false },
    appendSent: true,
    caldav: 'https://caldav.icloud.com',
    help: 'Create an app-specific password at account.apple.com → Sign-In and Security. Use your full iCloud address as the username.'
  },
  {
    id: 'yahoo',
    label: 'Yahoo Mail',
    imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
    appendSent: true,
    help: 'Generate an app password in Yahoo Account Security → "Generate app password".'
  },
  {
    id: 'zoho',
    label: 'Zoho Mail',
    imap: { host: 'imap.zoho.com', port: 993, secure: true },
    smtp: { host: 'smtp.zoho.com', port: 465, secure: true },
    appendSent: true,
    caldav: 'https://calendar.zoho.com/caldav',
    help: 'Enable IMAP access in Zoho Mail settings and create an application-specific password. EU accounts use imap.zoho.eu / smtp.zoho.eu.'
  },
  {
    id: 'fastmail',
    label: 'Fastmail',
    imap: { host: 'imap.fastmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.fastmail.com', port: 465, secure: true },
    appendSent: true,
    caldav: 'https://caldav.fastmail.com/dav/calendars',
    help: 'Create an app password in Settings → Privacy & Security → Integrations.'
  },
  {
    id: 'outlook',
    label: 'Outlook.com / Microsoft 365',
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    smtp: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
    appendSent: true,
    help: 'Microsoft has turned off app-password (basic) sign-in for most Outlook.com and many Microsoft 365 accounts. Use “Sign in with Microsoft” instead.'
  },
  {
    id: 'custom',
    label: 'Other (IMAP/SMTP)',
    imap: { host: '', port: 993, secure: true },
    smtp: { host: '', port: 465, secure: true },
    appendSent: true,
    help: 'Use the IMAP and SMTP settings from your provider. Port 993/465 use TLS; 143/587 use STARTTLS.'
  }
]

// ---------------------------------------------------------------- mail

export interface MailAddress {
  name: string
  address: string
}

export interface MailAttachment {
  id: string
  filename: string
  mime: string
  size: number
}

export interface MailMessage {
  id: string
  thread_id: string
  account_id: string
  message_id: string
  from: MailAddress
  to: MailAddress[]
  cc: MailAddress[]
  subject: string
  date: string
  snippet: string
  body_text: string
  body_html: string | null
  is_read: boolean
  is_outbound: boolean
  attachments: MailAttachment[]
}

export interface EnrollmentSummary {
  id: string
  sequence_id: string
  sequence_name: string
  status: EnrollmentStatus
  current_step: number
  total_steps: number
  next_run_at: string | null
}

export interface MailThread {
  id: string
  account_id: string
  subject: string
  snippet: string
  last_message_at: string
  message_count: number
  unread_count: number
  participants: MailAddress[]
  has_attachments: boolean
  done: boolean
  task_ids: string[]
  enrollment: EnrollmentSummary | null
  /** set when AI triage has classified the thread */
  ai: { category: EmailCategory; priority: 1 | 2 | 3; summary: string } | null
}

export interface ThreadDetail extends MailThread {
  messages: MailMessage[]
}

export type MailFolder = 'inbox' | 'followups' | 'sent' | 'done' | 'all'

export interface ThreadQuery {
  folder: MailFolder
  account_id?: string | null
  search?: string
  unread_only?: boolean
  /** only threads AI triage put in this category */
  ai_category?: EmailCategory | null
  limit?: number
}

export interface ComposeInput {
  account_id: string
  to: string
  cc?: string
  subject: string
  /** plain text; converted to simple HTML for sending */
  body: string
  /** row id of the message being replied to / forwarded */
  reply_to?: string | null
}

export interface OutboxItem {
  id: string
  account_id: string
  to: string
  subject: string
  status: 'queued' | 'sent' | 'failed'
  error: string | null
  source: 'manual' | 'sequence' | 'automation'
  created_at: string
  sent_at: string | null
}

export interface EmailTemplate {
  id: string
  name: string
  subject: string
  body: string
}

// ---------------------------------------------------------------- follow-up sequences

export interface SendWindow {
  /** 0 = Sunday … 6 = Saturday */
  days: number[]
  start: string
  end: string
}

export interface SequenceStep {
  id: string
  /** days to wait after the previous email (or enrollment) */
  wait_days: number
  /** sent as a reply in the same thread; supports {{first_name}}, {{name}}, {{subject}} */
  body: string
}

export interface Sequence {
  id: string
  name: string
  window: SendWindow
  daily_cap: number
  steps: SequenceStep[]
  active_count: number
}

export type SequenceInput = Pick<Sequence, 'name' | 'window' | 'daily_cap'> & { steps: Omit<SequenceStep, 'id'>[] }

export type EnrollmentStatus = 'active' | 'replied' | 'completed' | 'stopped' | 'bounced' | 'failed'

export interface Enrollment extends EnrollmentSummary {
  thread_id: string
  thread_subject: string
  to: string
  enrolled_at: string
  last_sent_at: string | null
  stopped_reason: string | null
}

export const SEQUENCE_VARS = ['{{first_name}}', '{{name}}', '{{subject}}']

// ---------------------------------------------------------------- calendar

export interface CalendarInfo {
  id: string
  account_id: string | null
  name: string
  color: string
  enabled: boolean
  read_only: boolean
}

/** One occurrence of an event. Dates use the app format: `YYYY-MM-DD` (all-day) or `YYYY-MM-DDTHH:mm` (local). */
export interface CalendarEvent {
  /** occurrence id: `eventId` or `eventId@YYYY-MM-DDTHH:mm` for recurring instances */
  id: string
  event_id: string
  calendar_id: string
  title: string
  start: string
  end: string
  all_day: boolean
  location: string
  description: string
  task_id: string | null
  recurring: boolean
  color: string
}

export interface EventInput {
  calendar_id: string
  title: string
  start: string
  end: string
  all_day: boolean
  location?: string
  description?: string
  task_id?: string | null
}
