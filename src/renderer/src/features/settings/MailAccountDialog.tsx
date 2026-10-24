import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Search, XCircle } from 'lucide-react'
import type { DetectedMailSettings, MailAccountConfig, ServerConfig } from '@shared/mail'
import type { OAuthProvider } from '@shared/integrations'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/ui'
import { Button, Input, Modal } from '@/components/ui'
import { Select } from '@/components/selects'

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(s.trim())
const PROVIDER_NAME: Record<OAuthProvider, string> = { google: 'Google', microsoft: 'Microsoft' }
const BLANK: Omit<ServerConfig, 'user'> = { host: '', port: 993, secure: true }

type Check = { imap: string | null; smtp: string | null }

/**
 * Add an email account starting from the address alone: the provider and servers are
 * detected (ADR-013), and only what that provider needs is asked for.
 */
export function MailAccountDialog({ onClose, signIn }: { onClose: () => void; signIn: (p: OAuthProvider) => void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [detected, setDetected] = useState<DetectedMailSettings | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [usePassword, setUsePassword] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [imap, setImap] = useState({ ...BLANK })
  const [smtp, setSmtp] = useState({ ...BLANK, port: 465 })
  const [user, setUser] = useState('')
  const [syncDays, setSyncDays] = useState(30)
  const [busy, setBusy] = useState(false)
  const [check, setCheck] = useState<Check | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lookedUp = useRef('')

  const valid = isEmail(email)
  const trimmed = email.trim().toLowerCase()

  // look the address up once it is complete (debounced)
  useEffect(() => {
    if (!valid) {
      lookedUp.current = ''
      setDetected(null)
      setNotFound(false)
      return
    }
    if (lookedUp.current === trimmed) return
    const h = setTimeout(async () => {
      lookedUp.current = trimmed
      setDetecting(true)
      setCheck(null)
      try {
        const d = await api.getMailSettingsFor(trimmed)
        if (lookedUp.current !== trimmed) return
        setDetected(d)
        setNotFound(!d)
        setUsePassword(false)
        if (d) {
          setImap(d.imap)
          setSmtp(d.smtp)
          setUser(d.username === 'local' ? trimmed.split('@')[0] : trimmed)
          setAdvanced(false)
        } else {
          setImap({ ...BLANK })
          setSmtp({ ...BLANK, port: 465 })
          setUser(trimmed)
          setAdvanced(true)
        }
      } finally {
        setDetecting(false)
      }
    }, 450)
    return () => clearTimeout(h)
  }, [trimmed, valid])

  const oauth = detected?.oauth ?? null
  const passwordNeeded = !oauth || usePassword
  const passwordLabel =
    detected?.passwordKind === 'normal' || (!detected && notFound) ? 'Password (the one you use for webmail)' : 'App password (not your normal password)'
  const userWarning = /\s/.test(user) ? 'The username can’t contain spaces. It is usually your full email address.' : null

  const config = (): MailAccountConfig => ({
    imap: { ...imap, user: user.trim() || trimmed },
    smtp: { ...smtp, user: user.trim() || trimmed },
    syncDays,
    appendSent: detected?.appendSent ?? true,
    preset: detected?.preset ?? 'custom'
  })
  const input = () => ({ kind: 'mail' as const, name: name.trim() || trimmed, email: trimmed, password, config: config() })

  const save = async (force = false) => {
    setError(null)
    setBusy(true)
    try {
      if (!force) {
        const r = await api.testAccount(input())
        setCheck({ imap: r.imap, smtp: r.smtp })
        if (r.imap || r.smtp) return
      }
      await window.bridge.invoke('createAccount', [input()])
      toast(`Added ${trimmed} — syncing now`, 'success')
      onClose()
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  const canSave = valid && !detecting && passwordNeeded && !!password && !!imap.host && !!smtp.host && !userWarning
  const failed = check && (check.imap || check.smtp)

  return (
    <Modal
      title="Add email account"
      onClose={onClose}
      confirmDiscard={!!(email || password)}
      width={600}
      footer={
        <>
          {error && <span className="mr-auto self-center text-[13px] text-danger">{error}</span>}
          {failed && (
            <Button variant="ghost" disabled={busy} onClick={() => save(true)} title="Add it anyway, e.g. when the server is only reachable from the office network">
              Add anyway
            </Button>
          )}
          {passwordNeeded && (
            <Button variant="primary" disabled={!canSave || busy} onClick={() => save()}>
              {busy && <Loader2 size={14} className="animate-spin" />} {busy ? 'Checking…' : 'Add account'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-muted">Email address</span>
            <Input autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className="mt-1" spellCheck={false} />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Your name (shown to recipients)</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" className="mt-1" />
          </label>
        </div>
        {email.trim() && !valid && !email.includes('@') && email.length > 3 && (
          <p className="text-xs text-danger">Enter the full email address, including the @ (for example name@company.com).</p>
        )}

        {detecting && (
          <p className="flex items-center gap-2 text-muted">
            <Loader2 size={14} className="animate-spin" /> Finding the settings for {trimmed.split('@')[1]}…
          </p>
        )}

        {!detecting && detected && (
          <div className="rounded-lg bg-hover px-3 py-2 text-xs">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-fg">
              <Search size={12} /> {detected.label}
              <span className="font-normal text-muted">· {detected.source === 'guess' ? 'found by trying common server names' : detected.source === 'mx' ? 'recognised from the domain’s mail servers' : detected.source === 'autoconfig' ? 'published settings' : 'known provider'}</span>
            </div>
            <p className="text-muted">{detected.help}</p>
          </div>
        )}
        {!detecting && notFound && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
            FollowUp couldn’t find the settings for <b>{trimmed.split('@')[1]}</b> automatically. Enter the incoming (IMAP) and outgoing (SMTP) server names from your
            email provider or IT team below.
          </p>
        )}

        {!detecting && oauth && !usePassword && (
          <div className="space-y-2 rounded-lg border border-accent/40 p-3">
            <Button variant="primary" onClick={() => (onClose(), signIn(oauth))}>
              Sign in with {PROVIDER_NAME[oauth]}
            </Button>
            <p className="text-xs text-muted">Recommended: no password is stored, and {oauth === 'google' ? 'Google Calendar is added too' : 'it works with Microsoft’s security rules'}.</p>
            <button type="button" className="text-xs text-accent hover:underline" onClick={() => setUsePassword(true)}>
              {detected?.passwordKind === 'none' ? 'Use a password anyway (usually refused by Microsoft)' : 'Use an app password instead'}
            </button>
          </div>
        )}

        {!detecting && (detected || notFound) && passwordNeeded && (
          <>
            <label className="block">
              <span className="text-xs text-muted">{passwordLabel}</span>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={detected?.passwordKind === 'normal' || notFound ? 'Mailbox password' : 'Paste the app password'} className="mt-1" autoComplete="off" />
              <span className="mt-1 block text-[11px] text-muted">
                Stored encrypted with Windows (DPAPI) on this PC only.
                {oauth && (
                  <button type="button" className="ml-2 text-accent hover:underline" onClick={() => setUsePassword(false)}>
                    Back to Sign in with {PROVIDER_NAME[oauth]}
                  </button>
                )}
              </span>
            </label>
            <div>
              <button type="button" className="text-xs text-accent hover:underline" onClick={() => setAdvanced(!advanced)}>
                {advanced ? 'Hide' : 'Show'} server settings
              </button>
              {advanced && (
                <div className="mt-2 space-y-2 rounded-lg border border-line p-3">
                  <ServerRow label="Incoming (IMAP)" v={imap} set={setImap} />
                  <ServerRow label="Outgoing (SMTP)" v={smtp} set={setSmtp} />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-xs text-muted">Username</span>
                      <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder={trimmed || 'name@company.com'} className="mt-1" spellCheck={false} />
                    </label>
                    <label className="block">
                      <span className="text-xs text-muted">History to import</span>
                      <Select value={syncDays} onChange={(e) => setSyncDays(Number(e.target.value))} className="mt-1 w-full">
                        {[7, 30, 90, 365].map((d) => (
                          <option key={d} value={d}>Last {d} days</option>
                        ))}
                      </Select>
                    </label>
                  </div>
                  {userWarning && <p className="text-xs text-danger">{userWarning}</p>}
                </div>
              )}
            </div>
          </>
        )}

        {check && (
          <div className={cn('space-y-1 rounded-lg border px-3 py-2', failed ? 'border-danger/40 bg-danger/5' : 'border-green-500/40 bg-green-500/5')}>
            <Line label="Receiving (IMAP):" err={check.imap} />
            <Line label="Sending (SMTP):" err={check.smtp} />
            {failed && (
              <p className="flex items-start gap-1.5 pt-1 text-xs text-muted">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" /> Fix the problem and click Add account again. The account isn’t added until both connections work.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function Line({ label, err }: { label: string; err: string | null }) {
  return (
    <div className="flex items-start gap-2">
      {err ? <XCircle size={15} className="mt-0.5 shrink-0 text-danger" /> : <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-green-500" />}
      <span>
        <span className="font-medium">{label}</span> {err ?? 'connected'}
      </span>
    </div>
  )
}

function ServerRow({ label, v, set }: { label: string; v: Omit<ServerConfig, 'user'>; set: (x: Omit<ServerConfig, 'user'>) => void }) {
  return (
    <div className="grid grid-cols-[110px_1fr_80px_110px] items-center gap-2">
      <span className="text-xs text-muted">{label}</span>
      <Input value={v.host} onChange={(e) => set({ ...v, host: e.target.value.trim() })} placeholder="mail.company.com" aria-label={`${label} server`} spellCheck={false} />
      <Input type="number" value={v.port} onChange={(e) => set({ ...v, port: Number(e.target.value) })} aria-label={`${label} port`} />
      <Select value={v.secure ? 'tls' : 'starttls'} onChange={(e) => set({ ...v, secure: e.target.value === 'tls' })} aria-label={`${label} security`}>
        <option value="tls">SSL/TLS</option>
        <option value="starttls">STARTTLS</option>
      </Select>
    </div>
  )
}
