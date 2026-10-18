import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { AlertTriangle, CheckCircle2, Hash, Loader2, Pencil, Plus, RefreshCw, Send, Trash2, XCircle } from 'lucide-react'
import { INTEGRATION_LABEL, type Integration, type IntegrationInput, type IntegrationKind } from '@shared/integrations'
import { api } from '@/lib/api'
import { useIntegrations } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/ui'
import { Button, IconButton, Input, Modal, Segmented, Toggle } from '@/components/ui'
import { ListSelect, Select } from '@/components/selects'

const Mark = ({ kind }: { kind: IntegrationKind }) => (
  <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white', kind === 'teams_webhook' ? 'bg-indigo-500' : 'bg-emerald-600')}>
    {kind === 'teams_webhook' ? 'T' : 'S'}
  </span>
)

export function IntegrationsSection() {
  const { data: integrations = [] } = useIntegrations()
  const [dialog, setDialog] = useState<{ app: 'slack' | 'teams'; integration: Integration | null } | null>(null)
  return (
    <div>
      {integrations.length === 0 && <p className="mb-3 text-muted">Nothing connected yet.</p>}
      <ul className="mb-3 space-y-2">
        {integrations.map((i) => (
          <li key={i.id} className={cn('flex items-center gap-3 rounded-lg border border-line px-3 py-2.5', !i.enabled && 'opacity-60')}>
            <Mark kind={i.kind} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">
                {i.name}
                <span className="ml-2 text-xs font-normal text-muted">
                  {i.config.channel_name ? `#${i.config.channel_name}` : i.config.channel ?? i.target}
                </span>
              </div>
              <div className={cn('truncate text-xs', i.last_error ? 'text-danger' : 'text-muted')}>
                {i.last_error ? (
                  <span className="inline-flex items-center gap-1">
                    <AlertTriangle size={11} /> {i.last_error}
                  </span>
                ) : (
                  [
                    i.config.mirrorNotifications && 'notifications',
                    i.config.watch?.enabled && `:${i.config.watch.emoji}: → tasks`,
                    i.last_used_at ? `last used ${formatDistanceToNow(new Date(i.last_used_at), { addSuffix: true })}` : 'not used yet'
                  ]
                    .filter(Boolean)
                    .join(' · ')
                )}
              </div>
            </div>
            {i.config.watch?.enabled && (
              <IconButton
                label="Check the channel for new tasks now"
                onClick={async () => {
                  const n = await api.syncIntegration(i.id)
                  toast(n ? `Created ${n} task${n === 1 ? '' : 's'} from Slack` : 'No new reacted messages', n ? 'success' : 'info')
                }}
              >
                <RefreshCw size={14} />
              </IconButton>
            )}
            <IconButton
              label="Send a test message"
              onClick={async () => {
                const err = await api.testIntegration({ kind: i.kind, name: i.name, config: i.config, id: i.id })
                toast(err ?? `Test message sent to ${i.name}`, err ? 'error' : 'success')
              }}
            >
              <Send size={14} />
            </IconButton>
            <IconButton label="Edit" onClick={() => setDialog({ app: i.kind === 'teams_webhook' ? 'teams' : 'slack', integration: i })}>
              <Pencil size={14} />
            </IconButton>
            <IconButton label="Remove" onClick={() => window.confirm(`Disconnect ${i.name}?`) && api.deleteIntegration(i.id)}>
              <Trash2 size={14} />
            </IconButton>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button onClick={() => setDialog({ app: 'slack', integration: null })}>
          <Plus size={14} /> Slack
        </Button>
        <Button onClick={() => setDialog({ app: 'teams', integration: null })}>
          <Plus size={14} /> Microsoft Teams
        </Button>
      </div>
      {dialog && <IntegrationDialog app={dialog.app} integration={dialog.integration} onClose={() => setDialog(null)} />}
    </div>
  )
}

const HELP: Record<IntegrationKind, React.ReactNode> = {
  slack_webhook: (
    <>
      In Slack: go to <b>api.slack.com/apps</b> → Create New App (from scratch) → <b>Incoming Webhooks</b> → turn on → <b>Add New Webhook to Workspace</b> →
      pick the channel → copy the URL (https://hooks.slack.com/services/…).
    </>
  ),
  slack_bot: (
    <>
      In Slack: <b>api.slack.com/apps</b> → Create New App → <b>OAuth &amp; Permissions</b> → add the bot scopes <code>chat:write</code>, <code>channels:read</code>,{' '}
      <code>channels:history</code> (and <code>groups:read</code>, <code>groups:history</code> for private channels) → <b>Install to Workspace</b> → copy the
      Bot User OAuth Token (xoxb-…). Then invite the app in the channel: <code>/invite @your-app</code>.
    </>
  ),
  teams_webhook: (
    <>
      In Teams: open the channel → <b>⋯ → Workflows</b> → “Post to a channel when a webhook request is received” → follow the steps and copy the URL it shows.
    </>
  )
}

function IntegrationDialog({ app, integration, onClose }: { app: 'slack' | 'teams'; integration: Integration | null; onClose: () => void }) {
  const [kind, setKind] = useState<IntegrationKind>(integration?.kind ?? (app === 'teams' ? 'teams_webhook' : 'slack_webhook'))
  const [name, setName] = useState(integration?.name ?? (app === 'teams' ? 'Teams' : 'Slack'))
  const [secret, setSecret] = useState('')
  const [channel, setChannel] = useState(integration?.config.channel ?? '')
  const [channelName, setChannelName] = useState(integration?.config.channel_name ?? '')
  const [channels, setChannels] = useState<{ id: string; name: string; member: boolean }[] | null>(null)
  const [mirror, setMirror] = useState(integration?.config.mirrorNotifications ?? true)
  const [watch, setWatch] = useState(integration?.config.watch?.enabled ?? false)
  const [emoji, setEmoji] = useState(integration?.config.watch?.emoji ?? 'memo')
  const [listId, setListId] = useState<string | null>(integration?.config.watch?.list_id ?? null)
  const [busy, setBusy] = useState<'test' | 'save' | 'channels' | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const snapshot = JSON.stringify([kind, name, secret, channel, mirror, watch, emoji, listId])
  const [initialSnapshot] = useState(snapshot)

  const input = (): IntegrationInput => ({
    kind,
    name,
    secret: secret.trim() || undefined,
    config: {
      mirrorNotifications: mirror,
      ...(kind === 'slack_bot' ? { channel: channel.trim(), channel_name: channelName || undefined, watch: { enabled: watch, emoji, list_id: listId } } : {})
    }
  })
  const invoke = async <T,>(method: string, args: unknown[]): Promise<T> => {
    try {
      return (await window.bridge.invoke(method, args)) as T
    } catch (e) {
      throw new Error((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const test = async () => {
    setBusy('test')
    setResult(null)
    try {
      const err = await invoke<string | null>('testIntegration', [{ ...input(), id: integration?.id }])
      setResult(err ? { ok: false, text: err } : { ok: true, text: 'Test message sent. Check the channel.' })
    } finally {
      setBusy(null)
    }
  }
  const save = async () => {
    setBusy('save')
    setResult(null)
    try {
      if (integration) await invoke('updateIntegration', [integration.id, input()])
      else await invoke('createIntegration', [input()])
      toast(integration ? 'Saved' : `${name} connected`, 'success')
      onClose()
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }
  const loadChannels = async () => {
    setBusy('channels')
    setResult(null)
    try {
      const list = await invoke<{ id: string; name: string; member: boolean }[]>('listSlackChannels', [{ token: secret, id: integration?.id }])
      setChannels(list)
      if (!channel && list[0]) (setChannel(list[0].id), setChannelName(list[0].name))
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }
  const hasSecret = !!secret.trim() || !!integration

  return (
    <Modal
      title={integration ? `Edit ${integration.name}` : app === 'teams' ? 'Connect Microsoft Teams' : 'Connect Slack'}
      onClose={onClose}
      confirmDiscard={snapshot !== initialSnapshot}
      width={580}
      footer={
        <>
          <Button variant="ghost" onClick={test} disabled={!!busy || !hasSecret}>
            {busy === 'test' && <Loader2 size={14} className="animate-spin" />} Send test message
          </Button>
          <Button variant="primary" onClick={save} disabled={!!busy || !hasSecret}>
            {integration ? 'Save' : 'Connect'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        {app === 'slack' && !integration && (
          <Segmented<IntegrationKind>
            value={kind}
            options={[['slack_webhook', 'Post messages (webhook)'], ['slack_bot', 'Post + create tasks (Slack app)']]}
            onChange={(k) => (setKind(k), setResult(null))}
          />
        )}
        <p className="rounded-lg bg-hover px-3 py-2 text-xs text-muted">{HELP[kind]}</p>
        <label className="block">
          <span className="text-xs text-muted">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
        </label>
        <label className="block">
          <span className="text-xs text-muted">
            {kind === 'slack_bot' ? 'Bot token' : 'Webhook URL'}
            {integration ? ' (leave empty to keep the saved one)' : ''}
          </span>
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={kind === 'slack_bot' ? 'xoxb-…' : kind === 'slack_webhook' ? 'https://hooks.slack.com/services/…' : 'https://…'}
            className="mt-1 font-mono"
          />
          <span className="mt-1 block text-[11px] text-muted">Stored encrypted on this PC. Anyone with this {kind === 'slack_bot' ? 'token' : 'URL'} can post to the channel.</span>
        </label>

        {kind === 'slack_bot' && (
          <div>
            <span className="text-xs text-muted">Channel</span>
            <div className="mt-1 flex gap-2">
              {channels ? (
                <Select
                  value={channel}
                  onChange={(e) => (setChannel(e.target.value), setChannelName(channels.find((c) => c.id === e.target.value)?.name ?? ''))}
                  className="flex-1"
                  aria-label="Slack channel"
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                      {c.member ? '' : ' (invite the app first)'}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input value={channel} onChange={(e) => (setChannel(e.target.value), setChannelName(''))} placeholder="Channel ID, e.g. C0123456789" aria-label="Slack channel ID" />
              )}
              <Button onClick={loadChannels} disabled={!!busy || !hasSecret}>
                {busy === 'channels' ? <Loader2 size={14} className="animate-spin" /> : <Hash size={14} />} Choose from list
              </Button>
            </div>
          </div>
        )}

        <Toggle
          label="Send my FollowUp notifications here"
          hint="Due dates, reminders, the daily summary and automation notifications."
          checked={mirror}
          onChange={setMirror}
        />

        {kind === 'slack_bot' && (
          <div className="rounded-lg border border-line p-3">
            <Toggle
              label="Create tasks from messages with a reaction"
              hint="FollowUp checks the channel every 2 minutes while it runs; messages from the last 7 days are picked up once."
              checked={watch}
              onChange={setWatch}
            />
            {watch && (
              <div className="mt-3 ml-12 grid grid-cols-[auto_1fr] items-center gap-2">
                <span className="text-xs text-muted">Reaction</span>
                <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="memo" className="w-40 font-mono" aria-label="Reaction emoji name" />
                <span className="text-xs text-muted">Add to list</span>
                <ListSelect value={listId} onChange={setListId} />
              </div>
            )}
          </div>
        )}

        {result && (
          <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2', result.ok ? 'border-green-500/40 bg-green-500/5' : 'border-danger/40 bg-danger/5 text-danger')}>
            {result.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-green-500" /> : <XCircle size={15} className="mt-0.5 shrink-0" />}
            <span>{result.text}</span>
          </div>
        )}
        {!integration && <p className="text-[11px] text-muted">{INTEGRATION_LABEL[kind]}</p>}
      </div>
    </Modal>
  )
}
