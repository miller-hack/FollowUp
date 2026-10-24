import { useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import type { OAuthProvider } from '@shared/integrations'
import { api } from '@/lib/api'
import { queryClient, useOAuthClients } from '@/lib/hooks'
import { toast } from '@/stores/ui'
import { Button, Input, Modal } from '@/components/ui'

const NAME: Record<OAuthProvider, string> = { google: 'Google', microsoft: 'Microsoft' }

/** Brand-neutral marks (a letter in a circle) so the buttons stay recognisable without logos. */
const Mark = ({ p }: { p: OAuthProvider }) => (
  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-fg text-[10px] font-bold text-panel">{p === 'google' ? 'G' : 'M'}</span>
)

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** "Sign in with Google / Microsoft" with first-time client setup and a waiting dialog. */
export function useSignIn() {
  const [waiting, setWaiting] = useState<OAuthProvider | null>(null)
  const [setup, setSetup] = useState<{ provider: OAuthProvider; reconnect?: string } | null>(null)

  const signIn = async (provider: OAuthProvider, reconnect?: string) => {
    setWaiting(provider)
    try {
      // bypass the api proxy so "needs a client id" opens the setup dialog instead of an error toast
      const accounts = (await window.bridge.invoke('signInWithProvider', [provider, reconnect])) as { email: string }[]
      void queryClient.invalidateQueries()
      toast(reconnect ? `Signed in again as ${accounts[0]?.email}` : `Added ${accounts[0]?.email} — syncing now`, 'success')
    } catch (e) {
      const msg = clean(e)
      if (msg.startsWith('NEEDS_CLIENT')) setSetup({ provider, reconnect })
      else if (!/cancelled/i.test(msg)) toast(msg, 'error')
    } finally {
      setWaiting(null)
    }
  }

  const dialogs = (
    <>
      {waiting && (
        <Modal title={`Sign in with ${NAME[waiting]}`} onClose={() => void api.cancelSignIn()} width={440}>
          <div className="flex items-start gap-3 text-[13px]">
            <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-accent" />
            <div>
              <p className="font-medium">Finish signing in in your browser.</p>
              <p className="mt-1 text-muted">
                A {NAME[waiting]} sign-in page opened in your default browser. Allow access to mail{waiting === 'google' ? ' and calendar' : ''}, then come back here.
              </p>
              {waiting === 'google' && (
                <p className="mt-2 rounded-lg bg-hover px-3 py-2 text-xs text-muted">
                  Google shows <b>“Error 403: access_denied”</b>? The Google project FollowUp uses is in testing, and only the addresses on its <b>Test users</b> list
                  can sign in. Ask whoever set up FollowUp’s Google sign-in to add your address (Google Cloud → Google Auth Platform → Audience → Test users), then
                  try again. Or close this and add the account with an app password.
                </p>
              )}
              {waiting === 'microsoft' && (
                <p className="mt-2 rounded-lg bg-hover px-3 py-2 text-xs text-muted">
                  Microsoft says <b>“Need admin approval”</b>? Your organisation only lets apps its administrator approved read mail. Ask your IT administrator to
                  approve “FollowUp”.
                </p>
              )}
              <Button className="mt-3" onClick={() => void api.cancelSignIn()}>Cancel</Button>
            </div>
          </div>
        </Modal>
      )}
      {setup && (
        <ClientSetup
          provider={setup.provider}
          onClose={() => setSetup(null)}
          onSaved={() => {
            const s = setup
            setSetup(null)
            void signIn(s.provider, s.reconnect)
          }}
        />
      )}
    </>
  )
  return { signIn, waiting, dialogs }
}

export function SignInButtons({ signIn, busy }: { signIn: (p: OAuthProvider) => void; busy: boolean }) {
  return (
    <>
      <Button onClick={() => signIn('google')} disabled={busy}>
        <Mark p="google" /> Sign in with Google
      </Button>
      <Button onClick={() => signIn('microsoft')} disabled={busy}>
        <Mark p="microsoft" /> Sign in with Microsoft
      </Button>
    </>
  )
}

const STEPS: Record<OAuthProvider, React.ReactNode> = {
  google: (
    <ol className="list-decimal space-y-1 pl-5">
      <li>Open console.cloud.google.com and create a project (any name).</li>
      <li>APIs &amp; Services → Library: enable <b>Gmail API</b> and <b>CalDAV API</b>.</li>
      <li>Google Auth Platform → <b>Branding</b>: app name and your email.</li>
      <li><b>Audience</b>: External, keep it in Testing, and under <b>Test users</b> add <b>every address that will sign in</b> (yours and your teammates’). Anyone not on this list gets “Error 403: access_denied”.</li>
      <li><b>Data access</b>: add the scopes <code>openid</code>, <code>…/auth/userinfo.email</code>, <code>…/auth/userinfo.profile</code>, <code>https://mail.google.com/</code> and <code>…/auth/calendar</code>.</li>
      <li><b>Clients</b> → Create client → Application type <b>Desktop app</b>. Copy the <b>Client ID</b> and <b>Client secret</b> here.</li>
    </ol>
  ),
  microsoft: (
    <ol className="list-decimal space-y-1 pl-5">
      <li>Open portal.azure.com → Microsoft Entra ID → App registrations → New registration.</li>
      <li>Supported accounts: <b>any organizational directory and personal Microsoft accounts</b>.</li>
      <li>Redirect URI: platform <b>Public client/native (mobile &amp; desktop)</b>, value <code>http://localhost</code>.</li>
      <li>Authentication: set <b>Allow public client flows</b> to Yes.</li>
      <li>Copy the <b>Application (client) ID</b> here. No secret is needed.</li>
    </ol>
  )
}

function ClientSetup({ provider, onClose, onSaved }: { provider: OAuthProvider; onClose: () => void; onSaved: () => void }) {
  const { data: clients } = useOAuthClients()
  const [clientId, setClientId] = useState(clients?.[provider].builtIn ? '' : (clients?.[provider].clientId ?? ''))
  const [secret, setSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    setError(null)
    try {
      await window.bridge.invoke('setOAuthClient', [provider, clientId, provider === 'google' ? secret : undefined])
      void queryClient.invalidateQueries({ queryKey: ['oauthClients'] })
      onSaved()
    } catch (e) {
      setError(clean(e))
    }
  }
  return (
    <Modal
      title={`Connect FollowUp to ${NAME[provider]}`}
      onClose={onClose}
      width={560}
      footer={
        <>
          {error && <span className="mr-auto self-center text-[13px] text-danger">{error}</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!clientId.trim() || (provider === 'google' && !secret.trim())} onClick={save}>
            Save and sign in
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <p className="text-muted">
          {NAME[provider]} sign-in needs a free “client ID” that identifies this app to {NAME[provider]}. It is a one-time setup (about 5 minutes); your password is
          never seen by FollowUp.
        </p>
        <div className="rounded-lg bg-hover px-3 py-2 text-xs">{STEPS[provider]}</div>
        {provider === 'google' && (
          <p className="text-xs text-muted">
            While the Google project is in “Testing”, Google asks you to sign in again every 7 days. Setting it to “In production” removes that limit; Google then
            shows an “unverified app” notice at sign-in, which you can continue past for your own use.
          </p>
        )}
        <label className="block">
          <span className="text-xs text-muted">{provider === 'google' ? 'Client ID' : 'Application (client) ID'}</span>
          <Input
            autoFocus
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={provider === 'google' ? '1234-abc.apps.googleusercontent.com' : '00000000-0000-0000-0000-000000000000'}
            className="mt-1 font-mono"
            spellCheck={false}
          />
        </label>
        {provider === 'google' && (
          <label className="block">
            <span className="text-xs text-muted">Client secret</span>
            <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="GOCSPX-…" className="mt-1" autoComplete="off" />
            <span className="mt-1 block text-[11px] text-muted">Stored encrypted on this PC.</span>
          </label>
        )}
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
          onClick={() => window.open(provider === 'google' ? 'https://console.cloud.google.com/apis/credentials' : 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade')}
        >
          <ExternalLink size={12} /> Open the {provider === 'google' ? 'Google Cloud console' : 'Azure portal'}
        </button>
      </div>
    </Modal>
  )
}

/** Link to change the client ID later (shown under the account list). */
export function OAuthClientLinks({ onEdit }: { onEdit: (p: OAuthProvider) => void }) {
  const { data: clients } = useOAuthClients()
  if (!clients) return null
  const configured = (['google', 'microsoft'] as OAuthProvider[]).filter((p) => clients[p].clientId && !clients[p].builtIn)
  if (!configured.length) return null
  return (
    <p className="mt-2 text-xs text-muted">
      Sign-in client IDs:{' '}
      {configured.map((p, i) => (
        <span key={p}>
          {i > 0 && ' · '}
          <button type="button" className="text-accent hover:underline" onClick={() => onEdit(p)}>
            {NAME[p]}
          </button>
        </span>
      ))}
    </p>
  )
}

export { ClientSetup }
