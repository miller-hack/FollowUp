import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ArrowUpCircle, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import type { UpdateStatus } from '@shared/integrations'
import { api } from '@/lib/api'
import { useSettings, useUpdateStatus } from '@/lib/hooks'
import { Button, Input, Toggle } from '@/components/ui'

function describe(s: UpdateStatus): { icon: React.ReactNode; text: string } {
  const ago = s.checked_at ? ` (checked ${formatDistanceToNow(new Date(s.checked_at), { addSuffix: true })})` : ''
  switch (s.state) {
    case 'dev':
      return { icon: null, text: 'Updates work in the installed app (this is a development build).' }
    case 'unconfigured':
      return { icon: null, text: 'This build has no update server. Enter one below, or install new versions manually.' }
    case 'checking':
      return { icon: <Loader2 size={14} className="animate-spin" />, text: 'Checking for updates…' }
    case 'available':
    case 'downloading':
      return { icon: <Loader2 size={14} className="animate-spin" />, text: `Downloading version ${s.next ?? ''}… ${s.percent ?? 0}%` }
    case 'ready':
      return { icon: <ArrowUpCircle size={14} className="text-accent" />, text: `Version ${s.next} is ready. It installs when you restart FollowUp.` }
    case 'none':
      return { icon: <CheckCircle2 size={14} className="text-emerald-600" />, text: `You have the latest version${ago}.` }
    case 'error':
      return { icon: <XCircle size={14} className="text-danger" />, text: `Update check failed: ${s.error}${ago}` }
    default:
      return { icon: null, text: 'Updates are checked automatically.' }
  }
}

export function UpdatesSection() {
  const { data: status } = useUpdateStatus()
  const { data: settings } = useSettings()
  const [feed, setFeed] = useState<string | null>(null)
  if (!status || !settings) return null
  const d = describe(status)
  const busy = status.state === 'checking' || status.state === 'downloading' || status.state === 'available'
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div>FollowUp {status.current}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted" role="status">
            {d.icon}
            {d.text}
          </div>
        </div>
        {status.state === 'ready' ? (
          <Button variant="primary" onClick={() => api.installUpdate()}>
            Restart and update
          </Button>
        ) : (
          <Button disabled={status.state === 'dev' || busy} onClick={() => api.checkForUpdates()}>
            Check for updates
          </Button>
        )}
      </div>
      <Toggle
        label="Download updates automatically"
        hint="Checks at startup and every 6 hours; the update installs the next time FollowUp restarts."
        checked={settings.updates.auto}
        onChange={(auto) => api.updateSettings({ updates: { ...settings.updates, auto } })}
      />
      <label className="block">
        <span className="text-xs text-muted">
          Update server {status.source && !settings.updates.feedUrl ? `(built in: ${status.source})` : '(optional)'}
        </span>
        <div className="mt-1 flex gap-2">
          <Input
            value={feed ?? settings.updates.feedUrl}
            onChange={(e) => setFeed(e.target.value)}
            placeholder="https://example.com/followup/ — folder with latest.yml and the installer"
            spellCheck={false}
          />
          {feed !== null && feed !== settings.updates.feedUrl && (
            <Button
              onClick={async () => {
                await api.updateSettings({ updates: { ...settings.updates, feedUrl: feed.trim() } })
                setFeed(null)
              }}
            >
              Save
            </Button>
          )}
        </div>
      </label>
    </div>
  )
}
