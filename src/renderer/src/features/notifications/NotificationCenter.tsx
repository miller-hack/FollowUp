import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { AlarmClock, Bell, CalendarClock, Check, Sun, Trash2, Zap } from 'lucide-react'
import { localDateTime } from '@shared/dates'
import type { AppNotification } from '@shared/types'
import { api } from '@/lib/api'
import { useNotifications, useReminders } from '@/lib/hooks'
import { cn, formatDue } from '@/lib/utils'
import { useUi } from '@/stores/ui'
import { Button, IconButton, Input, Popover } from '@/components/ui'

const KIND_ICON: Record<AppNotification['kind'], React.ReactNode> = {
  due: <CalendarClock size={14} />,
  reminder: <AlarmClock size={14} />,
  digest: <Sun size={14} />,
  info: <Bell size={14} />,
  automation: <Zap size={14} />
}

export function NotificationCenter() {
  const { data: notes = [] } = useNotifications()
  const unread = notes.filter((n) => !n.read_at).length
  return (
    <Popover
      align="start"
      className="w-96 p-0"
      trigger={
        <IconButton label={unread ? `Notifications (${unread} unread)` : 'Notifications'} className="relative h-8 w-8 border border-line bg-panel">
          <Bell size={15} />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </IconButton>
      }
    >
      {(close) => <Panel close={close} notes={notes} />}
    </Popover>
  )
}

function Panel({ close, notes }: { close: () => void; notes: AppNotification[] }) {
  const [tab, setTab] = useState<'inbox' | 'reminders'>('inbox')
  return (
    <div>
      <div className="flex items-center gap-3 border-b border-line px-3 pt-2.5">
        {(['inbox', 'reminders'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn('-mb-px border-b-2 pb-2 text-[13px] capitalize', tab === t ? 'border-accent font-medium' : 'border-transparent text-muted')}
          >
            {t === 'inbox' ? 'Notifications' : 'Reminders'}
          </button>
        ))}
        <div className="flex-1" />
        {tab === 'inbox' && notes.length > 0 && (
          <div className="mb-1.5 flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => api.markNotificationsRead()}>
              <Check size={13} /> Read all
            </Button>
            <IconButton label="Clear all" onClick={() => api.clearNotifications()}>
              <Trash2 size={13} />
            </IconButton>
          </div>
        )}
      </div>
      <div className="max-h-[60vh] overflow-auto p-1.5">{tab === 'inbox' ? <Inbox notes={notes} close={close} /> : <Reminders close={close} />}</div>
    </div>
  )
}

function Inbox({ notes, close }: { notes: AppNotification[]; close: () => void }) {
  if (!notes.length) return <div className="py-10 text-center text-xs text-muted">You’re all caught up.</div>
  return (
    <ul>
      {notes.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => {
              void api.markNotificationsRead([n.id])
              if (n.task_id) {
                useUi.getState().openTask(n.task_id)
                close()
              }
            }}
            className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-hover"
          >
            <span className="mt-0.5 text-muted">{KIND_ICON[n.kind]}</span>
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate text-[13px]', !n.read_at && 'font-semibold')}>{n.title}</span>
              <span className="block truncate text-xs text-muted">{n.body}</span>
            </span>
            <span className="shrink-0 text-[11px] text-muted">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</span>
            {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
          </button>
        </li>
      ))}
    </ul>
  )
}

function Reminders({ close }: { close: () => void }) {
  const { data: reminders = [] } = useReminders()
  const [title, setTitle] = useState('')
  const [at, setAt] = useState(() => localDateTime(new Date(Date.now() + 3600_000)))
  const add = async () => {
    if (!title.trim() || !at) return
    await api.createReminder({ title, remind_at: at })
    setTitle('')
  }
  return (
    <div>
      <div className="mb-2 flex gap-1.5 p-1">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Remind me to…" onKeyDown={(e) => e.key === 'Enter' && add()} />
        <input
          type="datetime-local"
          value={at}
          onChange={(e) => setAt(e.target.value)}
          aria-label="Reminder time"
          className="h-8 rounded-md border border-line bg-panel px-1.5 text-xs outline-none focus:border-accent"
        />
        <Button variant="primary" size="sm" className="h-8" onClick={add} disabled={!title.trim()}>Add</Button>
      </div>
      {reminders.length === 0 && <div className="py-6 text-center text-xs text-muted">No upcoming reminders.</div>}
      <ul>
        {reminders.map((r) => (
          <li key={r.id} className="group flex items-center gap-2 rounded-md px-2.5 py-1.5 hover:bg-hover">
            <button type="button" aria-label="Mark done" title="Mark done" onClick={() => api.updateReminder(r.id, { done: true })} className="h-4 w-4 shrink-0 rounded-full border-2 border-line hover:border-accent" />
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                if (r.task_id) {
                  useUi.getState().openTask(r.task_id)
                  close()
                }
              }}
            >
              <span className="block truncate text-[13px]">{r.title}</span>
              <span className={cn('block text-xs', r.notified_at ? 'text-amber-500' : 'text-muted')}>{formatDue(r.remind_at)}</span>
            </button>
            <button type="button" aria-label="Delete reminder" onClick={() => api.deleteReminder(r.id)} className="invisible text-muted group-hover:visible">
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
