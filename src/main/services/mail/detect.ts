import { resolveMx as dnsResolveMx } from 'node:dns/promises'
import { connect } from 'node:net'
import type { DetectedMailSettings, ServerConfig } from '@shared/mail'
import { MAIL_PRESETS } from '@shared/mail'

/**
 * Works out an email address's IMAP/SMTP settings from the address alone (ADR-013):
 * 1. well-known domains (gmail.com, outlook.com, …);
 * 2. the domain's MX records (Google Workspace, Microsoft 365, Zoho, Fastmail, iCloud, Yahoo);
 * 3. Thunderbird's autoconfig database, then the domain's own autoconfig file;
 * 4. common host names (mail.<domain>, imap.<domain>, smtp.<domain>) that accept a connection.
 * Every network step is time-boxed; nothing is sent except DNS queries, HTTPS GETs that name
 * only the domain, and bare TCP connects (no login).
 */

type Server = Omit<ServerConfig, 'user'>

export interface DetectDeps {
  resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>
  fetchText(url: string): Promise<string | null>
  canConnect(host: string, port: number): Promise<boolean>
}

const TIMEOUT = 4000

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))])

const defaultDeps: DetectDeps = {
  resolveMx: (d) => dnsResolveMx(d),
  fetchText: async (url) => {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), TIMEOUT)
    try {
      const r = await fetch(url, { signal: ctl.signal, redirect: 'follow' })
      return r.ok ? await r.text() : null
    } catch {
      return null
    } finally {
      clearTimeout(t)
    }
  },
  canConnect: (host, port) =>
    new Promise((resolve) => {
      const s = connect({ host, port })
      const done = (ok: boolean) => {
        s.destroy()
        resolve(ok)
      }
      s.setTimeout(2500, () => done(false))
      s.once('connect', () => done(true))
      s.once('error', () => done(false))
    })
}

const preset = (id: string) => MAIL_PRESETS.find((p) => p.id === id)!

function fromPreset(id: string, label: string, source: DetectedMailSettings['source'], extra: Partial<DetectedMailSettings> = {}): DetectedMailSettings {
  const p = preset(id)
  return {
    preset: id,
    label,
    source,
    oauth: id === 'gmail' ? 'google' : id === 'outlook' ? 'microsoft' : null,
    imap: { ...p.imap },
    smtp: { ...p.smtp },
    appendSent: p.appendSent,
    passwordKind: id === 'outlook' ? 'none' : 'app',
    username: 'email',
    help: p.help,
    ...extra
  }
}

const WORKSPACE_HELP =
  'This address uses Google Workspace. Click “Sign in with Google”, or use an app password: turn on 2-Step Verification, then create one at myaccount.google.com/apppasswords (your administrator may have turned app passwords off).'
const M365_HELP =
  'This address uses Microsoft 365. Microsoft has turned off password sign-in for most mailboxes, so click “Sign in with Microsoft”.'

/** Known consumer domains. */
function byDomain(domain: string): DetectedMailSettings | null {
  if (/^(gmail|googlemail)\.com$/.test(domain)) return fromPreset('gmail', 'Gmail', 'domain')
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(domain)) return fromPreset('outlook', 'Outlook.com', 'domain')
  if (/^(yahoo\.[a-z.]+|ymail\.com|rocketmail\.com)$/.test(domain)) return fromPreset('yahoo', 'Yahoo Mail', 'domain')
  if (/^(icloud|me|mac)\.com$/.test(domain)) return fromPreset('icloud', 'iCloud Mail', 'domain')
  if (/^(zoho|zohomail)\.com$/.test(domain)) return fromPreset('zoho', 'Zoho Mail', 'domain')
  if (/^zoho(mail)?\.eu$/.test(domain)) return zohoEu('domain')
  if (/^fastmail\.(com|fm)$/.test(domain)) return fromPreset('fastmail', 'Fastmail', 'domain')
  return null
}

function zohoEu(source: DetectedMailSettings['source']): DetectedMailSettings {
  return fromPreset('zoho', 'Zoho Mail (EU)', source, {
    imap: { host: 'imap.zoho.eu', port: 993, secure: true },
    smtp: { host: 'smtp.zoho.eu', port: 465, secure: true }
  })
}

/** Hosted mail recognised from where the domain's mail is delivered. */
function byMx(mx: string[]): DetectedMailSettings | null {
  const has = (re: RegExp) => mx.some((h) => re.test(h))
  if (has(/(^|\.)(google|googlemail)\.com$/)) return fromPreset('gmail', 'Google Workspace', 'mx', { help: WORKSPACE_HELP })
  if (has(/\.mail\.protection\.outlook\.com$/) || has(/(^|\.)outlook\.com$/))
    return fromPreset('outlook', 'Microsoft 365', 'mx', { smtp: { host: 'smtp.office365.com', port: 587, secure: false }, help: M365_HELP })
  if (has(/(^|\.)zoho\.eu$/)) return zohoEu('mx')
  if (has(/(^|\.)zoho(mail)?\.com$/)) return fromPreset('zoho', 'Zoho Mail', 'mx')
  if (has(/(^|\.)messagingengine\.com$/)) return fromPreset('fastmail', 'Fastmail', 'mx')
  if (has(/(^|\.)mail\.icloud\.com$/)) return fromPreset('icloud', 'iCloud Mail (custom domain)', 'mx')
  if (has(/(^|\.)yahoodns\.net$/)) return fromPreset('yahoo', 'Yahoo Mail', 'mx')
  return null
}

const SOCKET: Record<string, boolean | undefined> = { SSL: true, STARTTLS: false }

/** Parses a Thunderbird autoconfig (clientConfig v1.1) file. */
export function parseAutoconfig(xml: string, email: string): Pick<DetectedMailSettings, 'imap' | 'smtp' | 'username'> | null {
  const [local, domain] = email.split('@')
  const fill = (s: string) => s.replace(/%EMAILDOMAIN%/g, domain).replace(/%EMAILLOCALPART%/g, local).replace(/%EMAILADDRESS%/g, email)
  const servers = (tag: string, type: string) =>
    [...xml.matchAll(new RegExp(`<${tag}[^>]*type="${type}"[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => {
      const field = (f: string) => new RegExp(`<${f}>\\s*([^<]*?)\\s*</${f}>`).exec(m[1])?.[1] ?? ''
      return { host: fill(field('hostname')), port: Number(field('port')), secure: SOCKET[field('socketType')], username: field('username') }
    })
  // prefer implicit TLS, then STARTTLS; never plain text
  const pick = (list: ReturnType<typeof servers>) =>
    list.filter((s) => s.host && s.port && s.secure !== undefined).sort((a, b) => Number(b.secure) - Number(a.secure))[0]
  const imap = pick(servers('incomingServer', 'imap'))
  const smtp = pick(servers('outgoingServer', 'smtp'))
  if (!imap || !smtp) return null
  return {
    imap: { host: imap.host, port: imap.port, secure: imap.secure! },
    smtp: { host: smtp.host, port: smtp.port, secure: smtp.secure! },
    username: imap.username.includes('%EMAILLOCALPART%') && !imap.username.includes('@') ? 'local' : 'email'
  }
}

/** The registrable part of an MX host: mx1.mail.example.co.uk → example.co.uk (good enough for ISPDB). */
const baseDomain = (host: string): string => {
  const parts = host.replace(/\.$/, '').split('.')
  const n = parts.length >= 3 && parts.at(-2)!.length <= 3 && parts.at(-1)!.length === 2 ? 3 : 2
  return parts.slice(-n).join('.')
}

function custom(label: string, source: DetectedMailSettings['source'], imap: Server, smtp: Server, username: 'email' | 'local' = 'email'): DetectedMailSettings {
  return {
    preset: 'custom',
    label,
    source,
    oauth: null,
    imap,
    smtp,
    appendSent: true,
    passwordKind: 'normal',
    username,
    help: 'Use the password of this mailbox (the one you use for webmail). The username is usually the full email address.'
  }
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(email.trim())
}

export async function detectMailSettings(emailIn: string, deps: DetectDeps = defaultDeps): Promise<DetectedMailSettings | null> {
  const email = emailIn.trim().toLowerCase()
  if (!isValidEmail(email)) return null
  const domain = email.split('@')[1]

  const known = byDomain(domain)
  if (known) return known

  // MX and autoconfig in parallel
  const [mxRecords, ispdb, own] = await Promise.all([
    withTimeout(deps.resolveMx(domain), TIMEOUT, []),
    deps.fetchText(`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`),
    deps.fetchText(`https://autoconfig.${domain}/mail/config-v1.1.xml`)
  ])
  // a null MX (".") means the domain receives no mail: never probe an empty host (that would be this PC)
  const mx = mxRecords
    .sort((a, b) => a.priority - b.priority)
    .map((r) => r.exchange.toLowerCase().replace(/\.$/, ''))
    .filter((h) => h.includes('.'))

  const hosted = byMx(mx)
  if (hosted) return hosted

  for (const xml of [ispdb, own]) {
    const cfg = xml ? parseAutoconfig(xml, email) : null
    if (cfg) return custom(`Settings published for ${domain}`, 'autoconfig', cfg.imap, cfg.smtp, cfg.username)
  }

  // ISPDB knows many hosting companies by their MX domain (e.g. a shared host's mail servers)
  if (mx.length) {
    const mxBase = baseDomain(mx[0])
    if (mxBase !== domain) {
      const cfg = await deps.fetchText(`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(mxBase)}`).then((x) => (x ? parseAutoconfig(x, email) : null))
      if (cfg) return custom(`Settings published for ${mxBase}`, 'autoconfig', cfg.imap, cfg.smtp, cfg.username)
    }
  }

  // common names on the domain itself (cPanel, Plesk, many hosts), and the MX host
  const candidates = [...new Set([`mail.${domain}`, `imap.${domain}`, ...mx.slice(0, 1)])]
  let imapHost: string | null = null
  for (const h of candidates) {
    if (await deps.canConnect(h, 993)) {
      imapHost = h
      break
    }
  }
  if (imapHost) {
    const smtpCandidates = [...new Set([imapHost, `smtp.${domain}`, `mail.${domain}`])]
    for (const h of smtpCandidates) {
      if (await deps.canConnect(h, 465)) return custom(`Mail server ${imapHost}`, 'guess', { host: imapHost, port: 993, secure: true }, { host: h, port: 465, secure: true })
      if (await deps.canConnect(h, 587)) return custom(`Mail server ${imapHost}`, 'guess', { host: imapHost, port: 993, secure: true }, { host: h, port: 587, secure: false })
    }
    return custom(`Mail server ${imapHost}`, 'guess', { host: imapHost, port: 993, secure: true }, { host: imapHost, port: 465, secure: true })
  }
  return null
}
