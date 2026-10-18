import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format, isThisYear, isToday } from 'date-fns'
import {
  Archive, ArchiveRestore, CheckSquare, ChevronDown, Clock, Forward, Inbox, Mail, MailOpen, Paperclip, PenSquare, RefreshCw, Reply, ReplyAll, Search,
  Send, Square, X, Zap
} from 'lucide-react'
import type { MailFolder, MailMessage, MailThread, ThreadDetail } from '@shared/mail'
import { api } from '@/lib/api'
import { useAccounts, useSequences, useUnreadCount } from '@/lib/hooks'
import { cn, formatBytes } from '@/lib/utils'
import { toast, useUi } from '@/stores/ui'
import { Button, Empty, IconButton, MenuItem, Popover } from '@/components/ui'
import { Select } from '@/components/selects'
import { ListPicker } from '../tasks/pickers'
import { EmailBody } from './EmailBody'
import { forwardDraft, replyDraft } from './Compose'
import { CategoryChip, ThreadAi } from '../ai/MailAi'
import { EMAIL_CATEGORY_LABEL, type EmailCategory } from '@shared/ai'

const FOLDERS: { id: MailFolder; label: string; icon: React.ReactNode }[] = [
  { id: 'inbox', label: 'Inbox', icon: <Inbox size={15} /> },
  { id: 'followups', label: 'Follow-ups', icon: <Zap size={15} /> },
  { id: 'sent', label: 'Sent', icon: <Send size={15} /> },
  { id: 'done', label: 'Done', icon: <Archive size={15} /> },
  { id: 'all', label: 'All mail', icon: <Mail size={15} /> }
]

const when = (iso: string) => {
  const d = new Date(iso)
  return isToday(d) ? format(d, 'HH:mm') : format(d, isThisYear(d) ? 'MMM d' : 'MMM d, yyyy')
}

export function InboxPage() {
  const [params, setParams] = useSearchParams()
  const folder = (params.get('folder') as MailFolder) || 'inbox'
  const threadId = params.get('thread')
  const accountId = params.get('account')
  const category = (params.get('cat') as EmailCategory | null) || null
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const { data: accounts = [] } = useAccounts()
  const { data: unread = 0 } = useUnreadCount()
  const openCompose = useUi((s) => s.openCompose)
  const mailAccounts = accounts.filter((a) => a.kind === 'mail')
  useEffect(() => {
    const h = setTimeout(() => setQ(search), 250)
    return () => clearTimeout(h)
  }, [search])
  const { data: threads = [], isLoading } = useQuery({
    queryKey: ['threads', folder, accountId, q, category],
    queryFn: () => api.listThreads({ folder, account_id: accountId, search: q || undefined, ai_category: category }),
    placeholderData: (p) => p
  })
  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    if (k !== 'thread') next.delete('thread')
    if (k === 'folder') next.delete('cat')
    setParams(next, { replace: true })
  }

  if (!mailAccounts.length)
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-sm text-center">
          <Mail size={36} className="mx-auto mb-3 text-muted" />
          <h1 className="text-lg font-semibold">Connect your email</h1>
          <p className="mt-1 mb-4 text-muted">Add an IMAP/SMTP account with an app password to read, send and follow up on email here.</p>
          <Button variant="primary" onClick={() => (window.location.hash = '#/settings')}>Open Settings → Accounts</Button>
        </div>
      </div>
    )

  return (
    <div className="flex h-full">
      <aside className="flex w-48 shrink-0 flex-col border-r border-line bg-panel p-2">
        <Button variant="primary" className="mb-3 justify-center" onClick={() => openCompose()}>
          <PenSquare size={14} /> Compose
        </Button>
        {FOLDERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setParam('folder', f.id)}
            className={cn('flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left hover:bg-hover', folder === f.id && 'bg-hover font-medium')}
          >
            <span className="text-muted">{f.icon}</span>
            <span className="flex-1">{f.label}</span>
            {f.id === 'inbox' && unread > 0 && <span className="text-xs font-semibold text-accent">{unread}</span>}
          </button>
        ))}
        {mailAccounts.length > 1 && (
          <Select value={accountId ?? ''} onChange={(e) => setParam('account', e.target.value || null)} className="mt-4" aria-label="Account">
            <option value="">All accounts</option>
            {mailAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.email}</option>
            ))}
          </Select>
        )}
      </aside>

      <section className="flex w-[380px] shrink-0 flex-col border-r border-line">
        <div className="flex items-center gap-1.5 border-b border-line p-2">
          <label className="flex h-8 flex-1 items-center gap-1.5 rounded-md border border-line bg-panel px-2 text-muted focus-within:border-accent">
            <Search size={13} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search mail…" className="w-full bg-transparent text-[13px] text-fg outline-none" />
          </label>
          <IconButton
            label="Check for new mail"
            onClick={async () => {
              const n = await api.syncAllAccounts()
              toast(n ? 'Checking for new mail…' : 'Already syncing')
            }}
          >
            <RefreshCw size={14} />
          </IconButton>
        </div>
        {(category || threads.some((t) => t.ai)) && (
          <div className="flex flex-wrap gap-1 border-b border-line px-2 py-1.5">
            {[null, ...(Object.keys(EMAIL_CATEGORY_LABEL) as EmailCategory[])].map((c) => (
              <button
                key={c ?? 'all'}
                type="button"
                onClick={() => setParam('cat', c)}
                className={cn('rounded-full border px-2 py-0.5 text-[11px]', category === c ? 'border-accent bg-accent/10 text-accent' : 'border-line text-muted hover:text-fg')}
              >
                {c ? EMAIL_CATEGORY_LABEL[c] : 'All'}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-auto">
          {!isLoading && threads.length === 0 && <Empty>{q ? 'No matches.' : folder === 'inbox' ? 'Inbox zero 🎉' : 'Nothing here.'}</Empty>}
          {threads.map((t) => (
            <ThreadRow key={t.id} t={t} active={t.id === threadId} onClick={() => setParam('thread', t.id)} />
          ))}
        </div>
      </section>

      <main className="min-w-0 flex-1 overflow-hidden">
        {threadId ? <ThreadView key={threadId} id={threadId} onClose={() => setParam('thread', null)} /> : <Empty>Select an email to read it.</Empty>}
      </main>
    </div>
  )
}

function ThreadRow({ t, active, onClick }: { t: MailThread; active: boolean; onClick: () => void }) {
  const unread = t.unread_count > 0
  const others = t.participants.filter((p) => p.name !== 'me')
  const people = (others.length ? others : t.participants).map((p) => p.name || p.address.split('@')[0]).slice(0, 3).join(', ')
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('block w-full border-b border-line px-3 py-2.5 text-left hover:bg-hover/60', active && 'bg-accent/10 hover:bg-accent/10')}
    >
      <div className="flex items-center gap-2">
        {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
        <span className={cn('min-w-0 flex-1 truncate', unread ? 'font-semibold' : 'text-muted')}>
          {people}
          {t.message_count > 1 && <span className="ml-1 text-xs font-normal text-muted">{t.message_count}</span>}
        </span>
        {t.has_attachments && <Paperclip size={12} className="text-muted" />}
        <span className="shrink-0 text-xs text-muted">{when(t.last_message_at)}</span>
      </div>
      <div className={cn('truncate text-[13px]', unread && 'font-medium')}>{t.subject}</div>
      <div className="truncate text-xs text-muted">{t.snippet}</div>
      {(t.enrollment?.status === 'active' || t.task_ids.length > 0 || t.ai) && (
        <div className="mt-1 flex gap-1.5">
          {t.ai && <CategoryChip ai={t.ai} />}
          {t.enrollment?.status === 'active' && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              <Zap size={10} /> {t.enrollment.sequence_name} · {t.enrollment.current_step}/{t.enrollment.total_steps}
            </span>
          )}
          {t.task_ids.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-accent/10 px-1.5 text-[11px] text-accent">
              <CheckSquare size={10} /> task
            </span>
          )}
        </div>
      )}
    </button>
  )
}

function ThreadView({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: thread } = useQuery({ queryKey: ['thread', id], queryFn: () => api.getThread(id) })
  const { data: outbox = [] } = useQuery({ queryKey: ['outbox', id], queryFn: () => api.listOutbox(id) })
  const { data: accounts = [] } = useAccounts()
  const openCompose = useUi((s) => s.openCompose)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // opening an unread thread marks it read
  useEffect(() => {
    if (thread && thread.unread_count > 0) {
      const h = setTimeout(() => void api.markThreadRead(thread.id, true), 600)
      return () => clearTimeout(h)
    }
  }, [thread])

  if (!thread) return null
  const me = accounts.find((a) => a.id === thread.account_id)?.email ?? ''
  const last = thread.messages.at(-1)!
  const lastInbound = [...thread.messages].reverse().find((m) => !m.is_outbound) ?? last

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line bg-panel px-5 py-3">
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 flex-1 text-[17px] font-semibold select-text">
            {thread.subject}
            {thread.ai && (
              <span className="ml-2 align-middle">
                <CategoryChip ai={thread.ai} />
              </span>
            )}
          </h1>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={() => openCompose(replyDraft(thread, lastInbound, false, me))}>
            <Reply size={13} /> Reply
          </Button>
          <Button size="sm" onClick={() => openCompose(replyDraft(thread, lastInbound, true, me))}>
            <ReplyAll size={13} /> Reply all
          </Button>
          <Button size="sm" onClick={() => openCompose(forwardDraft(thread, last))}>
            <Forward size={13} /> Forward
          </Button>
          <span className="mx-1 h-5 w-px bg-line" />
          <CreateTaskButton threadId={thread.id} />
          <FollowUpButton thread={thread} />
          <span className="mx-1 h-5 w-px bg-line" />
          <Button size="sm" variant="ghost" onClick={() => api.setThreadDone(thread.id, !thread.done)}>
            {thread.done ? <ArchiveRestore size={13} /> : <Archive size={13} />} {thread.done ? 'Move to inbox' : 'Done'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => api.markThreadRead(thread.id, false)}>
            <MailOpen size={13} /> Mark unread
          </Button>
          <ThreadAi thread={thread} lastInbound={lastInbound} />
        </div>
        <LinkedTasks taskIds={thread.task_ids} threadId={thread.id} />
        {thread.enrollment && <EnrollmentBar thread={thread} />}
      </header>

      <div className="flex-1 space-y-3 overflow-auto px-5 py-4">
        {thread.messages.map((m, i) => {
          const open = i === thread.messages.length - 1 || !m.is_read || expanded.has(m.id)
          return (
            <MessageCard
              key={m.id}
              m={m}
              open={open}
              onToggle={() => {
                const next = new Set(expanded)
                if (next.has(m.id)) next.delete(m.id)
                else next.add(m.id)
                setExpanded(next)
              }}
            />
          )
        })}
        {outbox.map((o) => (
          <div key={o.id} className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]', o.status === 'failed' ? 'border-danger/40 text-danger' : 'border-line text-muted')}>
            {o.status === 'failed' ? <X size={14} /> : <Clock size={14} />}
            <span className="flex-1">
              {o.status === 'failed' ? `Couldn't send to ${o.to}: ${o.error}` : `Sending to ${o.to}…${o.error ? ` (retrying: ${o.error})` : ''}`}
            </span>
            {o.status === 'failed' && (
              <Button size="sm" onClick={() => api.retryOutbox(o.id)}>Retry</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => api.cancelOutbox(o.id)}>Cancel</Button>
          </div>
        ))}
      </div>
    </div>
  )
}

function MessageCard({ m, open, onToggle }: { m: MailMessage; open: boolean; onToggle: () => void }) {
  return (
    <article className={cn('rounded-xl border border-line bg-panel', m.is_outbound && 'border-accent/30')}>
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white', m.is_outbound ? 'bg-accent' : 'bg-slate-400')}>
          {(m.from.name || m.from.address)[0]?.toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            <span className="font-semibold">{m.is_outbound ? 'You' : m.from.name || m.from.address}</span>
            {!m.is_outbound && m.from.name && <span className="ml-1.5 text-xs text-muted">&lt;{m.from.address}&gt;</span>}
          </span>
          <span className="block truncate text-xs text-muted">{open ? `to ${m.to.map((t) => t.name || t.address).join(', ')}${m.cc.length ? `, cc ${m.cc.map((c) => c.address).join(', ')}` : ''}` : m.snippet}</span>
        </span>
        <span className="shrink-0 text-xs text-muted">{format(new Date(m.date), 'MMM d, HH:mm')}</span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <EmailBody html={m.body_html} text={m.body_text} />
          {m.attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {m.attachments.map((a) => (
                <button key={a.id} type="button" onClick={() => api.openMailAttachment(a.id)} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-hover">
                  <Paperclip size={12} />
                  <span className="max-w-56 truncate">{a.filename}</span>
                  <span className="text-muted">{formatBytes(a.size)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

function CreateTaskButton({ threadId }: { threadId: string }) {
  return (
    <ListPicker
      onChange={async (listId) => {
        const task = await api.createTaskFromThread(threadId, listId)
        toast(`Created task “${task.title}”`, 'success')
        useUi.getState().openTask(task.id)
      }}
      trigger={
        <Button size="sm">
          <CheckSquare size={13} /> Create task <ChevronDown size={12} />
        </Button>
      }
    />
  )
}

function FollowUpButton({ thread }: { thread: ThreadDetail }) {
  const { data: sequences = [] } = useSequences()
  const active = thread.enrollment?.status === 'active'
  if (active) return null
  return (
    <Popover
      trigger={
        <Button size="sm">
          <Zap size={13} /> Follow up <ChevronDown size={12} />
        </Button>
      }
    >
      {(close) => (
        <div className="w-64">
          <div className="px-2 pt-1 pb-1.5 text-xs text-muted">If nobody replies, automatically send:</div>
          {sequences.map((s) => (
            <MenuItem
              key={s.id}
              onClick={async () => {
                close()
                await api.enrollThread(thread.id, s.id)
                toast(`Follow-up “${s.name}” started`, 'success')
              }}
            >
              {s.name}
              <span className="ml-1 text-xs text-muted">· {s.steps.length} email{s.steps.length === 1 ? '' : 's'}</span>
            </MenuItem>
          ))}
          {sequences.length === 0 && <div className="px-2 pb-2 text-xs text-muted">No sequences yet.</div>}
          <MenuItem onClick={() => (close(), (window.location.hash = '#/followups'))}>Manage sequences…</MenuItem>
        </div>
      )}
    </Popover>
  )
}

function EnrollmentBar({ thread }: { thread: ThreadDetail }) {
  const e = thread.enrollment!
  const label: Record<string, string> = {
    active: e.next_run_at ? `next email ${format(new Date(e.next_run_at), 'EEE MMM d, HH:mm')}` : 'sending…',
    replied: 'they replied — stopped',
    completed: 'all follow-ups sent',
    stopped: 'stopped',
    bounced: 'the email bounced — stopped',
    failed: 'sending failed — stopped'
  }
  return (
    <div className={cn('mt-2 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs', e.status === 'active' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-hover text-muted')}>
      <Zap size={12} />
      <span className="flex-1">
        Follow-up <strong>{e.sequence_name}</strong> · step {Math.min(e.current_step + (e.status === 'active' ? 1 : 0), e.total_steps)}/{e.total_steps} · {label[e.status]}
      </span>
      {e.status === 'active' && (
        <button type="button" className="flex items-center gap-1 font-medium hover:underline" onClick={() => api.stopEnrollment(e.id)}>
          <Square size={10} fill="currentColor" /> Stop
        </button>
      )}
    </div>
  )
}

function LinkedTasks({ taskIds, threadId }: { taskIds: string[]; threadId: string }) {
  if (!taskIds.length) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted">Tasks:</span>
      {taskIds.map((id) => (
        <LinkedTaskChip key={id} id={id} threadId={threadId} />
      ))}
    </div>
  )
}

function LinkedTaskChip({ id, threadId }: { id: string; threadId: string }) {
  const { data: task } = useQuery({ queryKey: ['task', id], queryFn: () => api.getTask(id) })
  if (!task) return null
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded border border-line bg-panel px-1.5">
      <button type="button" className="max-w-56 truncate hover:underline" onClick={() => useUi.getState().openTask(id)}>
        {task.title}
      </button>
      <button type="button" aria-label="Unlink task" className="text-muted hover:text-fg" onClick={() => api.unlinkThreadTask(threadId, id)}>
        <X size={11} />
      </button>
    </span>
  )
}
