import { describe, expect, it } from 'vitest'
import { detectMailSettings, isValidEmail, parseAutoconfig, type DetectDeps } from '../src/main/services/mail/detect'
import { friendlyMailError } from '../src/main/services/mail/transport'

/** Offline stand-ins for DNS, HTTPS and TCP (ADR-013). */
function deps(o: { mx?: Record<string, string[]>; urls?: Record<string, string>; open?: string[] } = {}): DetectDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    resolveMx: async (d) => {
      calls.push(`mx ${d}`)
      const list = o.mx?.[d]
      if (!list) throw Object.assign(new Error('queryMx ENODATA'), { code: 'ENODATA' })
      return list.map((exchange, i) => ({ exchange, priority: (i + 1) * 10 }))
    },
    fetchText: async (url) => {
      calls.push(`get ${url}`)
      return o.urls?.[url] ?? null
    },
    canConnect: async (host, port) => {
      calls.push(`tcp ${host}:${port}`)
      return (o.open ?? []).includes(`${host}:${port}`)
    }
  }
}

const AUTOCONFIG = `<?xml version="1.0"?>
<clientConfig version="1.1"><emailProvider id="host.example">
  <incomingServer type="pop3"><hostname>pop.host.example</hostname><port>995</port><socketType>SSL</socketType></incomingServer>
  <incomingServer type="imap"><hostname>imap.%EMAILDOMAIN%</hostname><port>143</port><socketType>STARTTLS</socketType><username>%EMAILADDRESS%</username></incomingServer>
  <incomingServer type="imap"><hostname>secure.host.example</hostname><port>993</port><socketType>SSL</socketType><username>%EMAILADDRESS%</username></incomingServer>
  <outgoingServer type="smtp"><hostname>smtp.host.example</hostname><port>587</port><socketType>STARTTLS</socketType><username>%EMAILADDRESS%</username></outgoingServer>
  <outgoingServer type="smtp"><hostname>plain.host.example</hostname><port>25</port><socketType>plain</socketType></outgoingServer>
</emailProvider></clientConfig>`

describe('email address validation', () => {
  it('rejects addresses without @, with spaces or without a domain dot', () => {
    expect(isValidEmail('syed.aban.thetalentunlimited.com')).toBe(false)
    expect(isValidEmail('syed aban@company.com')).toBe(false)
    expect(isValidEmail('name@localhost')).toBe(false)
    expect(isValidEmail(' name@company.com ')).toBe(true)
  })

  it('returns nothing for an invalid address without any network lookups', async () => {
    const d = deps()
    expect(await detectMailSettings('syed.aban.thetalentunlimited.com', d)).toBeNull()
    expect(d.calls).toEqual([])
  })
})

describe('provider detection', () => {
  it('knows consumer domains without network access', async () => {
    const d = deps()
    expect(await detectMailSettings('someone@gmail.com', d)).toMatchObject({ preset: 'gmail', oauth: 'google', passwordKind: 'app', imap: { host: 'imap.gmail.com' } })
    expect(await detectMailSettings('a@hotmail.co.uk', d)).toMatchObject({ preset: 'outlook', oauth: 'microsoft', passwordKind: 'none' })
    expect(await detectMailSettings('a@yahoo.com', d)).toMatchObject({ preset: 'yahoo' })
    expect(await detectMailSettings('a@me.com', d)).toMatchObject({ preset: 'icloud' })
    expect(await detectMailSettings('a@zohomail.eu', d)).toMatchObject({ preset: 'zoho', imap: { host: 'imap.zoho.eu' } })
    expect(d.calls).toEqual([])
  })

  it('recognises Google Workspace from MX records (a university domain)', async () => {
    const d = deps({ mx: { 'cloud.uni.example': ['alt1.aspmx.l.google.com.', 'aspmx.l.google.com', 'aspmx2.googlemail.com'] } })
    const r = await detectMailSettings('Ali.Student@Cloud.Uni.Example', d)
    expect(r).toMatchObject({ preset: 'gmail', label: 'Google Workspace', source: 'mx', oauth: 'google', imap: { host: 'imap.gmail.com', port: 993 } })
    expect(r!.help).toMatch(/Google Workspace/)
  })

  it('recognises Microsoft 365 from MX records', async () => {
    const r = await detectMailSettings('a@corp.example', deps({ mx: { 'corp.example': ['corp-example.mail.protection.outlook.com'] } }))
    expect(r).toMatchObject({ label: 'Microsoft 365', oauth: 'microsoft', passwordKind: 'none', smtp: { host: 'smtp.office365.com', port: 587, secure: false } })
  })

  it('uses published autoconfig and prefers TLS over STARTTLS, never plain text', async () => {
    const r = await detectMailSettings('me@shop.example', deps({ urls: { 'https://autoconfig.thunderbird.net/v1.1/shop.example': AUTOCONFIG } }))
    expect(r).toMatchObject({
      preset: 'custom',
      source: 'autoconfig',
      passwordKind: 'normal',
      imap: { host: 'secure.host.example', port: 993, secure: true },
      smtp: { host: 'smtp.host.example', port: 587, secure: false }
    })
  })

  it('looks up the hosting company by its MX domain', async () => {
    const r = await detectMailSettings('me@small.example', deps({ mx: { 'small.example': ['mx1.host.example'] }, urls: { 'https://autoconfig.thunderbird.net/v1.1/host.example': AUTOCONFIG } }))
    expect(r).toMatchObject({ source: 'autoconfig', imap: { host: 'secure.host.example' } })
  })

  it('finds mail.<domain> on own hosting when DNS has no MX (cPanel / Dovecot)', async () => {
    const d = deps({ open: ['mail.talent.example:993', 'mail.talent.example:465'] })
    const r = await detectMailSettings('syed@talent.example', d)
    expect(r).toMatchObject({
      preset: 'custom',
      source: 'guess',
      label: 'Mail server mail.talent.example',
      passwordKind: 'normal',
      username: 'email',
      imap: { host: 'mail.talent.example', port: 993, secure: true },
      smtp: { host: 'mail.talent.example', port: 465, secure: true }
    })
  })

  it('returns null when nothing answers', async () => {
    expect(await detectMailSettings('x@nowhere.example', deps())).toBeNull()
  })

  it('never probes an empty host from a null MX record', async () => {
    const d = deps({ mx: { 'nomail.example': ['.', ''] } })
    expect(await detectMailSettings('x@nomail.example', d)).toBeNull()
    expect(d.calls.filter((c) => c.startsWith('tcp')).every((c) => /^tcp [a-z]+\.nomail\.example:/.test(c))).toBe(true)
  })

  it('parses a local-part username', () => {
    const xml = AUTOCONFIG.replaceAll('%EMAILADDRESS%', '%EMAILLOCALPART%')
    expect(parseAutoconfig(xml, 'me@shop.example')).toMatchObject({ username: 'local', imap: { host: 'secure.host.example' } })
  })
})

describe('sign-in error messages', () => {
  const auth = { authenticationFailed: true, message: 'Authentication failed' }
  it('explains app passwords for Gmail and the mailbox password for own servers', () => {
    expect(friendlyMailError(auth, false, 'gmail')).toMatch(/Google needs an app password/)
    expect(friendlyMailError(auth, false, 'custom')).toMatch(/full email address .* password of this mailbox/)
    expect(friendlyMailError(auth, false, 'outlook')).toMatch(/Sign in with Microsoft/)
  })

  it('turns a raw DNS error from SMTP into a readable message', () => {
    expect(friendlyMailError({ code: 'EDNS', message: 'getaddrinfo ENOTFOUND mail.cloud.uni.example' })).toMatch(/^Server not found/)
  })
})
