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
  /** a draft (not sent yet): Edit or Discard */
  is_draft: boolean
  attachments: MailAttachment[]
}

export type FollowUpKind = 'reply' | 'nudge'

/** Why a conversation is in Follow-up (ADR-015). */
export interface FollowUpInfo {
  /** reply: they wrote and nobody on our side answered; nudge: we wrote and they haven't answered */
  kind: FollowUpKind
  /** when the clock started (the latest real message) */
  since: string
  /** when it became (or becomes) due, counting working days only */
  due_at: string
  /** due now (not snoozed or dismissed) */
  due: boolean
  snoozed_until: string | null
  dismissed: boolean
}

export interface FollowUpCounts {
  reply: number
  nudge: number
}

export interface FollowUpSettings {
  /** email domains that count as "us" besides the connected mailboxes, e.g. ["acme.com"] */
  companyDomains: string[]
  /** also treat the connected mailboxes' own domains as ours (except public ones like gmail.com) */
  includeAccountDomains: boolean
  /** 0 = Sunday … 6 = Saturday; only these days count towards the waiting time */
  workingDays: number[]
  /** working hours without an answer from us before an email needs a reply */
  replyAfterHours: number
  /** working hours without an answer from them before our email needs a nudge */
  nudgeAfterHours: number
  /** conversations older than this are never brought up */
  lookbackDays: number
  /** one notification a day (at the digest time) when something needs follow-up */
  dailyReminder: boolean
}

/** Draft for a follow-up email, ready to edit and send. */
export interface FollowUpDraft {
  account_id: string
  to: string
  cc: string
  subject: string
  body: string
  reply_to: string
  /** 'ai' when the AI wrote it; 'template' when AI isn't set up or failed (then `ai_error` says why) */
  source: 'ai' | 'template'
  ai_error?: string
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
  followup: FollowUpInfo | null
  /** the client company of the other side, when it is in Clients */
  company: { id: string; name: string; stage: string | null; color: string | null } | null
  /** set when AI triage has classified the thread */
  ai: { category: EmailCategory; priority: 1 | 2 | 3; summary: string } | null
}

export interface ThreadDetail extends MailThread {
  messages: MailMessage[]
  /** server folders the conversation's messages are in */
  locations: { path: string; name: string; role: FolderRole | null }[]
}

/**
 * What a thread list shows: FollowUp's own views ('inbox' = Inbox minus Done, 'followups', 'done', 'all')
 * or a server folder by role ('sent', 'drafts', 'spam', 'trash', 'archive') or path ('folder:<path>').
 */
export type MailFolder = 'inbox' | 'followups' | 'sent' | 'done' | 'all' | 'drafts' | 'spam' | 'trash' | 'archive' | `folder:${string}`

export type FolderRole = 'inbox' | 'sent' | 'drafts' | 'spam' | 'trash' | 'archive' | 'all'

export interface MailFolderInfo {
  account_id: string
  path: string
  name: string
  role: FolderRole | null
  /** nesting level for display */
  depth: number
  unread: number
}

export interface ThreadQuery {
  folder: MailFolder
  account_id?: string | null
  search?: string
  unread_only?: boolean
  /** only threads AI triage put in this category */
  ai_category?: EmailCategory | null
  /** Follow-up view: which kind (both when omitted) */
  followup_kind?: FollowUpKind | null
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
  /** the saved draft this email was written from (removed once it is sent) */
  draft_id?: string | null
}

export interface OutboxItem {
  id: string
  account_id: string
  to: string
  subject: string
  status: 'queued' | 'sent' | 'failed'
  error: string | null
  source: 'manual' | 'sequence' | 'automation' | 'followup'
  created_at: string
  sent_at: string | null
}

export interface EmailTemplate {
  id: string
  name: string
  subject: string
  body: string
}

/** Variables in email templates. */
export const TEMPLATE_VARS = ['{{first_name}}', '{{name}}', '{{subject}}']

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
