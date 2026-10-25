import { useEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { Download, FolderOpen, HardDrive, Trash2 } from 'lucide-react'
import type { Settings as SettingsT } from '@shared/types'
import { api } from '@/lib/api'
import { useSettings, useTags } from '@/lib/hooks'
import { formatBytes } from '@/lib/utils'
import { toast } from '@/stores/ui'
import { Button, ColorGrid, IconButton, InlineEdit, Popover, Segmented, Toggle } from '@/components/ui'
import { AiSection } from './AiSettings'
import { IntegrationsSection } from './Integrations'
import { UpdatesSection } from './Updates'
import { AccountsSection } from './Accounts'
import { FollowUpSettingsEditor } from './FollowUpSettings'

function Section({ id, title, description, children }: { id?: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 rounded-xl border border-line bg-panel p-5">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function Settings() {
  const { data: settings } = useSettings()
  const { data: tags = [] } = useTags()
  const { data: backups = [] } = useQuery({ queryKey: ['backups'], queryFn: () => api.listBackups() })
  const { data: dataPath } = useQuery({ queryKey: ['dataPath'], queryFn: () => api.getDataPath() })
  const { hash } = useLocation()
  const loaded = !!settings
  useEffect(() => {
    if (loaded && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' })
  }, [hash, loaded])
  if (!settings) return null
  const set = (patch: Partial<SettingsT>) => api.updateSettings(patch)

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl space-y-4 px-8 py-8">
        <h1 className="text-2xl font-semibold">Settings</h1>

        <Section title="Appearance">
          <div className="flex items-center justify-between">
            <span>Theme</span>
            <Segmented value={settings.theme} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(theme) => set({ theme })} />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span>Week starts on</span>
            <Segmented value={settings.weekStart} options={[[1, 'Monday'], [0, 'Sunday']]} onChange={(weekStart) => set({ weekStart })} />
          </div>
        </Section>

        <Section title="Accounts" description="Gmail and Google Calendar, Outlook / Microsoft 365, or any IMAP/SMTP mailbox and CalDAV calendar.">
          <AccountsSection />
        </Section>

        <Section id="integrations" title="Slack & Teams" description="Post notifications and automation messages to channels; turn Slack messages into tasks.">
          <IntegrationsSection />
        </Section>

        <Section
          id="ai"
          title="AI"
          description="Assistant chat, writing help and email sorting. Only the items you use AI on are sent to the provider you choose; keys are encrypted on this PC."
        >
          <AiSection />
        </Section>

        <Section title="Email">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span>Check for new mail every</span>
              <select
                value={settings.mail.syncIntervalMin}
                onChange={(e) => set({ mail: { ...settings.mail, syncIntervalMin: Number(e.target.value) } })}
                className="h-8 rounded-md border border-line bg-panel px-2 text-[13px]"
              >
                {[1, 2, 5, 15, 30].map((m) => (
                  <option key={m} value={m}>{m} minute{m > 1 ? 's' : ''}</option>
                ))}
              </select>
            </div>
            <Toggle
              label="Load remote images in emails"
              hint="Off by default: remote images can tell the sender when you opened the email."
              checked={settings.mail.loadRemoteImages}
              onChange={(loadRemoteImages) => set({ mail: { ...settings.mail, loadRemoteImages } })}
            />
          </div>
        </Section>

        <Section id="followup" title="Follow-up" description="Which conversations show up in Inbox → Follow-up, and when.">
          <FollowUpSettingsEditor settings={settings} set={set} />
        </Section>

        <Section title="Notifications" description="Windows notifications for due dates, reminders and a daily summary.">
          <div className="space-y-3">
            <Toggle
              label="Notify when tasks are due"
              checked={settings.notifications.dueEnabled}
              onChange={(dueEnabled) => set({ notifications: { ...settings.notifications, dueEnabled } })}
            />
            {settings.notifications.dueEnabled && (
              <div className="ml-6 space-y-2 text-[13px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted">For tasks with a due time, notify</span>
                  <select
                    value={settings.notifications.dueLeadMin}
                    onChange={(e) => set({ notifications: { ...settings.notifications, dueLeadMin: Number(e.target.value) } })}
                    className="h-8 rounded-md border border-line bg-panel px-2"
                  >
                    {[
                      [0, 'At the due time'],
                      [5, '5 minutes before'],
                      [15, '15 minutes before'],
                      [30, '30 minutes before'],
                      [60, '1 hour before']
                    ].map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">For tasks due on a day (no time), notify at</span>
                  <input
                    type="time"
                    value={settings.notifications.dueDayTime}
                    onChange={(e) => e.target.value && set({ notifications: { ...settings.notifications, dueDayTime: e.target.value } })}
                    className="h-8 rounded-md border border-line bg-panel px-2"
                  />
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <Toggle
                label="Daily summary"
                checked={settings.notifications.digestEnabled}
                onChange={(digestEnabled) => set({ notifications: { ...settings.notifications, digestEnabled } })}
              />
              {settings.notifications.digestEnabled && (
                <input
                  type="time"
                  value={settings.notifications.digestTime}
                  onChange={(e) => e.target.value && set({ notifications: { ...settings.notifications, digestTime: e.target.value } })}
                  className="h-8 rounded-md border border-line bg-panel px-2 text-[13px]"
                  aria-label="Daily summary time"
                />
              )}
            </div>
          </div>
        </Section>

        <Section title="Window & startup">
          <div className="space-y-3">
            <Toggle
              label="Keep running in the system tray when the window is closed"
              hint="Needed for reminders, timers, email sync, automations and follow-ups to keep working while the window is closed."
              checked={settings.closeToTray}
              onChange={(closeToTray) => set({ closeToTray, closeAsked: true })}
            />
            <Toggle
              label="Start FollowUp when I sign in to Windows"
              hint="Starts minimized to the tray. Applies to the installed app."
              checked={settings.startAtLogin}
              onChange={(startAtLogin) => set({ startAtLogin })}
            />
          </div>
        </Section>

        <Section id="updates" title="Updates">
          <UpdatesSection />
        </Section>

        <Section title="Tags" description="Rename, recolor or delete tags used across all spaces.">
          {tags.length === 0 && <p className="text-muted">No tags yet.</p>}
          <div className="grid grid-cols-2 gap-1.5">
            {tags.map((t) => (
              <div key={t.id} className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-hover">
                <Popover trigger={<button type="button" aria-label="Tag color" className="h-3.5 w-3.5 rounded-full" style={{ background: t.color }} />}>
                  {(close) => <ColorGrid value={t.color} onChange={(color) => (api.updateTag(t.id, { color }), close())} />}
                </Popover>
                <InlineEdit value={t.name} onSave={(name) => api.updateTag(t.id, { name })} className="flex-1" />
                <IconButton label="Delete tag" className="invisible group-hover:visible" onClick={() => window.confirm(`Delete tag “${t.name}”?`) && api.deleteTag(t.id)}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Data & backups" description="All data is stored locally on this PC. A backup is taken automatically once a day (up to 14 kept; older ones go once backups pass 2 GB).">
          <div className="flex items-center gap-2 rounded-md bg-hover px-3 py-2 text-xs">
            <HardDrive size={14} className="text-muted" />
            <span className="flex-1 truncate font-mono select-text">{dataPath}</span>
            <Button size="sm" onClick={() => api.openDataFolder()}>
              <FolderOpen size={13} /> Open folder
            </Button>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              onClick={async () => {
                await api.backupNow()
                toast('Backup created', 'success')
              }}
            >
              Back up now
            </Button>
            <Button
              onClick={async () => {
                const file = await api.exportJson()
                if (file) toast(`Exported to ${file}`, 'success')
              }}
            >
              <Download size={14} /> Export JSON
            </Button>
          </div>
          {backups.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 text-xs font-medium text-muted">Recent backups</div>
              <ul className="space-y-0.5 text-xs">
                {backups.slice(0, 5).map((b) => (
                  <li key={b.file} className="flex justify-between gap-4">
                    <span className="truncate font-mono text-muted select-text">{b.file.split(/[\\/]/).pop()}</span>
                    <span className="shrink-0 text-muted">
                      {formatBytes(b.size)} · {formatDistanceToNow(new Date(b.created_at), { addSuffix: true })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section title="Keyboard shortcuts">
          <dl className="grid grid-cols-2 gap-y-1.5 text-[13px]">
            {[
              ['Ctrl + K', 'Search & command palette'],
              ['Ctrl + N', 'New task'],
              ['Ctrl + J', 'Open / close the AI assistant'],
              ['Esc', 'Close task panel / dialog'],
              ['Ctrl + Enter', 'Send comment or email · create & open task'],
              ['Alt + Enter', 'Quick add: fill in date, priority and tags with AI']
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt><kbd className="rounded border border-line bg-hover px-1.5 py-0.5 text-xs">{k}</kbd></dt>
                <dd className="text-muted">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
    </div>
  )
}
