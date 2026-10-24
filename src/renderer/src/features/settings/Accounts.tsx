import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { AlertTriangle, CalendarDays, CheckCircle2, Loader2, Mail, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react'
import { MAIL_PRESETS, type Account, type AccountInput, type CalDavConfig, type MailAccountConfig, type ServerConfig } from '@shared/mail'
import { api } from '@/lib/api'
import { useAccounts } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/ui'
import { Button, IconButton, Input, Modal } from '@/components/ui'
import { Select } from '@/components/selects'
import type { OAuthProvider } from '@shared/integrations'
import { ClientSetup, OAuthClientLinks, SignInButtons, useSignIn } from './SignIn'
import { MailAccountDialog } from './MailAccountDialog'

export function AccountsSection() {
  const { data: accounts = [] } = useAccounts()
  const [adding, setAdding] = useState<'mail' | 'caldav' | null>(null)
  const [editing, setEditing] = useState<Account | null>(null)
  const [editClient, setEditClient] = useState<OAuthProvider | null>(null)
  const { signIn, waiting, dialogs } = useSignIn()
  const oauthOf = (a: Account) => (a.config as MailAccountConfig | CalDavConfig).oauth
  return (
    <div>
      {accounts.length === 0 && <p className="mb-3 text-muted">No accounts yet. Add an email account to use the inbox and follow-ups.</p>}
      <ul className="mb-3 space-y-2">
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
            {a.kind === 'mail' ? <Mail size={16} className="text-muted" /> : <CalendarDays size={16} className="text-muted" />}
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => !oauthOf(a) && setEditing(a)} title={oauthOf(a) ? undefined : 'Edit'}>
              <div className="truncate font-medium">
                {a.email || a.name}
                {oauthOf(a) && (
                  <span className="ml-2 rounded bg-hover px-1.5 py-0.5 text-[10px] font-normal text-muted">
                    {a.kind === 'caldav' ? 'Google Calendar' : `${oauthOf(a) === 'google' ? 'Google' : 'Microsoft'} sign-in`}
                  </span>
                )}
              </div>
              <div className={cn('truncate text-xs', a.last_error ? 'text-danger' : 'text-muted')}>
                {a.last_error ? (
                  <span className="inline-flex items-center gap-1">
                    <AlertTriangle size={11} /> {a.last_error}
                  </span>
                ) : a.last_sync_at ? (
                  `Synced ${formatDistanceToNow(new Date(a.last_sync_at), { addSuffix: true })}`
                ) : (
                  'Waiting for first sync…'
                )}
              </div>
            </button>
            {oauthOf(a) && a.last_error && (
              <Button size="sm" disabled={!!waiting} onClick={() => signIn(oauthOf(a)!, a.id)}>
                Sign in again
              </Button>
            )}
            <IconButton
              label="Sync now"
              onClick={async () => {
                await api.syncAccount(a.id)
                toast('Syncing…')
              }}
            >
              <RefreshCw size={14} />
            </IconButton>
            <IconButton
              label="Remove account"
              onClick={() =>
                window.confirm(`Remove ${a.email || a.name}? Its emails, follow-ups and calendars are deleted from this PC (nothing is deleted on the server).`) &&
                api.deleteAccount(a.id)
              }
            >
              <Trash2 size={14} />
            </IconButton>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setAdding('mail')}>
          <Plus size={14} /> Add email account
        </Button>
        <SignInButtons signIn={(p) => void signIn(p)} busy={!!waiting} />
        <Button onClick={() => setAdding('caldav')}>
          <Plus size={14} /> Calendar (CalDAV)
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">
        Type your email address and FollowUp finds the right settings. Google adds Gmail and Google Calendar; Microsoft adds Outlook.com / Microsoft 365 mail.
      </p>
      <OAuthClientLinks onEdit={setEditClient} />
      {adding === 'mail' && !editing && <MailAccountDialog onClose={() => setAdding(null)} signIn={(p) => void signIn(p)} />}
      {(adding === 'caldav' || editing) && <AccountDialog kind={editing?.kind ?? adding!} account={editing} onClose={() => (setAdding(null), setEditing(null))} />}
      {editClient && <ClientSetup provider={editClient} onClose={() => setEditClient(null)} onSaved={() => setEditClient(null)} />}
      {dialogs}
    </div>
  )
}

function Server({ label, v, set }: { label: string; v: ServerConfig; set: (x: ServerConfig) => void }) {
  return (
    <div className="grid grid-cols-[60px_1fr_80px_110px] items-center gap-2">
      <span className="text-xs text-muted">{label}</span>
      <Input value={v.host} onChange={(e) => set({ ...v, host: e.target.value })} placeholder="server" aria-label={`${label} server`} />
      <Input type="number" value={v.port} onChange={(e) => set({ ...v, port: Number(e.target.value) })} aria-label={`${label} port`} />
      <Select value={v.secure ? 'tls' : 'starttls'} onChange={(e) => set({ ...v, secure: e.target.value === 'tls' })} aria-label={`${label} security`}>
        <option value="tls">SSL/TLS</option>
        <option value="starttls">STARTTLS</option>
      </Select>
    </div>
  )
}

function AccountDialog({ kind, account, onClose }: { kind: 'mail' | 'caldav'; account: Account | null; onClose: () => void }) {
  const mailCfg = account?.kind === 'mail' ? (account.config as MailAccountConfig) : null
  const davCfg = account?.kind === 'caldav' ? (account.config as CalDavConfig) : null
  const [presetId, setPresetId] = useState(mailCfg?.preset ?? 'gmail')
  const preset = MAIL_PRESETS.find((p) => p.id === presetId)!
  const [email, setEmail] = useState(account?.email ?? '')
  const [name, setName] = useState(account?.name ?? '')
  const [password, setPassword] = useState('')
  const [advanced, setAdvanced] = useState(presetId === 'custom')
  const [imap, setImap] = useState(mailCfg?.imap ?? { ...preset.imap, user: '' })
  const [smtp, setSmtp] = useState(mailCfg?.smtp ?? { ...preset.smtp, user: '' })
  const [syncDays, setSyncDays] = useState(mailCfg?.syncDays ?? 30)
  const [davUrl, setDavUrl] = useState(davCfg?.url ?? '')
  const [davUser, setDavUser] = useState(davCfg?.user ?? '')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ imap: string | null; smtp: string | null; caldav: string | null; calendars?: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const snapshot = JSON.stringify([presetId, email, name, password, imap, smtp, syncDays, davUrl, davUser])
  const [initialSnapshot] = useState(snapshot)

  const pickPreset = (id: string) => {
    const p = MAIL_PRESETS.find((x) => x.id === id)!
    setPresetId(id)
    setImap({ ...p.imap, user: imap.user })
    setSmtp({ ...p.smtp, user: smtp.user })
    setAdvanced(id === 'custom')
  }

  const input = (): AccountInput =>
    kind === 'mail'
      ? {
          kind,
          name: name || email,
          email,
          password: password || undefined,
          config: {
            imap: { ...imap, user: imap.user || email },
            smtp: { ...smtp, user: smtp.user || email },
            syncDays,
            appendSent: presetId === 'custom' ? true : preset.appendSent,
            preset: presetId
          }
        }
      : { kind, name: name || davUser, email: davUser, password: password || undefined, config: { url: davUrl.trim(), user: davUser } }

  const test = async () => {
    setTesting(true)
    setResult(null)
    try {
      setResult(await api.testAccount({ ...input(), accountId: account?.id }))
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    setError(null)
    try {
      if (account) await window.bridge.invoke('updateAccount', [account.id, input()])
      else await window.bridge.invoke('createAccount', [input()])
      toast(account ? 'Account updated' : 'Account added — syncing now', 'success')
      onClose()
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const ok = result && !result.imap && !result.smtp && !result.caldav
  const Check = ({ label, err }: { label: string; err: string | null }) => (
    <div className="flex items-start gap-2">
      {err ? <XCircle size={15} className="mt-0.5 shrink-0 text-danger" /> : <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-green-500" />}
      <span>
        <span className="font-medium">{label}</span> {err ?? 'connected'}
      </span>
    </div>
  )
  return (
    <Modal
      title={account ? `Edit ${account.email}` : kind === 'mail' ? 'Add email account' : 'Add calendar account'}
      onClose={onClose}
      confirmDiscard={snapshot !== initialSnapshot}
      width={600}
      footer={
        <>
          {error && <span className="mr-auto self-center text-[13px] text-danger">{error}</span>}
          <Button variant="ghost" onClick={test} disabled={testing}>
            {testing && <Loader2 size={14} className="animate-spin" />} Test connection
          </Button>
          <Button variant="primary" onClick={save}>{account ? 'Save' : 'Add account'}</Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        {kind === 'mail' ? (
          <>
            <label className="block">
              <span className="text-xs text-muted">Provider</span>
              <Select value={presetId} onChange={(e) => pickPreset(e.target.value)} className="mt-1 w-full" disabled={!!account}>
                {MAIL_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </Select>
            </label>
            <p className="rounded-lg bg-hover px-3 py-2 text-xs text-muted">{preset.help}</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-muted">Email address</span>
                <Input autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="mt-1" />
              </label>
              <label className="block">
                <span className="text-xs text-muted">Your name (shown to recipients)</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" className="mt-1" />
              </label>
            </div>
          </>
        ) : (
          <>
            <p className="rounded-lg bg-hover px-3 py-2 text-xs text-muted">
              Works with iCloud (https://caldav.icloud.com), Fastmail, Zoho, Nextcloud and other CalDAV servers. For Google Calendar, close this and use Sign in with Google.
            </p>
            <label className="block">
              <span className="text-xs text-muted">Server URL</span>
              <Input autoFocus value={davUrl} onChange={(e) => setDavUrl(e.target.value)} placeholder="https://caldav.icloud.com" className="mt-1" />
            </label>
            <label className="block">
              <span className="text-xs text-muted">Username</span>
              <Input value={davUser} onChange={(e) => setDavUser(e.target.value)} placeholder="you@icloud.com" className="mt-1" />
            </label>
          </>
        )}
        <label className="block">
          <span className="text-xs text-muted">
            {kind === 'mail' && presetId === 'custom' ? 'Password' : 'App password'}
            {account ? ' (leave empty to keep the saved one)' : ''}
          </span>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••••••" className="mt-1" autoComplete="off" />
          <span className="mt-1 block text-[11px] text-muted">Stored encrypted with Windows (DPAPI) on this PC only.</span>
        </label>

        {kind === 'mail' && (
          <div>
            <button type="button" className="text-xs text-accent hover:underline" onClick={() => setAdvanced(!advanced)}>
              {advanced ? 'Hide' : 'Show'} server settings
            </button>
            {advanced && (
              <div className="mt-2 space-y-2 rounded-lg border border-line p-3">
                <Server label="IMAP" v={imap} set={setImap} />
                <Server label="SMTP" v={smtp} set={setSmtp} />
                <div className="grid grid-cols-2 gap-2">
                  <Input value={imap.user} onChange={(e) => (setImap({ ...imap, user: e.target.value }), setSmtp({ ...smtp, user: e.target.value }))} placeholder="Username (defaults to the email address)" />
                  <Select value={syncDays} onChange={(e) => setSyncDays(Number(e.target.value))}>
                    {[7, 30, 90, 365].map((d) => (
                      <option key={d} value={d}>Import the last {d} days</option>
                    ))}
                  </Select>
                </div>
              </div>
            )}
          </div>
        )}

        {result && (
          <div className={cn('space-y-1 rounded-lg border px-3 py-2', ok ? 'border-green-500/40 bg-green-500/5' : 'border-danger/40 bg-danger/5')}>
            {kind === 'mail' ? (
              <>
                <Check label="Receiving (IMAP):" err={result.imap} />
                <Check label="Sending (SMTP):" err={result.smtp} />
              </>
            ) : (
              <Check label="Calendar:" err={result.caldav ?? null} />
            )}
            {kind === 'caldav' && !result.caldav && <div className="text-xs text-muted">{result.calendars} calendar(s) found</div>}
          </div>
        )}
      </div>
    </Modal>
  )
}
