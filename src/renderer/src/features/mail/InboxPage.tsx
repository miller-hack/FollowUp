import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format, isThisYear, isToday } from 'date-fns'
import {
  Archive, ArchiveRestore, Building2, CheckSquare, ChevronDown, Clock, FileText, Folder, FolderInput, Forward, Inbox, Mail, MailOpen, Paperclip,
  PenSquare, RefreshCw, Reply, ReplyAll, RotateCcw, Search, Send, ShieldAlert, ShieldCheck, Trash2, X
} from 'lucide-react'
import type { FolderRole, MailFolder, MailFolderInfo, MailMessage, MailThread, ThreadDetail } from '@shared/mail'
import { api } from '@/lib/api'
import { useAccounts, useFollowUpCounts, useMailFolders, useUnreadCount } from '@/lib/hooks'
import { cn, formatBytes } from '@/lib/utils'
import { toast, useUi } from '@/stores/ui'
import { Button, Empty, IconButton, MenuItem, MenuSeparator, Popover } from '@/components/ui'
import { Select } from '@/components/selects'
import { ResizablePanel } from '@/components/Resizable'
import { ListPicker } from '../tasks/pickers'
import { EmailBody } from './EmailBody'
import { forwardDraft, replyDraft } from './Compose'
import { CategoryChip, ThreadAi } from '../ai/MailAi'
import { EMAIL_CATEGORY_LABEL, type EmailCategory } from '@shared/ai'
import { FollowUpBadge, FollowUpPanel, waitingText } from './FollowUpPanel'
import { ClientsView } from '../clients/ClientsView'

const when = (iso: string) => {
  const d = new Date(iso)
  return isToday(d) ? format(d, 'HH:mm') : format(d, isThisYear(d) ? 'MMM d' : 'MMM d, yyyy')
}

const ROLE_VIEWS: { role: FolderRole; view: MailFolder; label: string; icon: React.ReactNode }[] = [
  { role: 'drafts', view: 'drafts', label: 'Drafts', icon: <FileText size={15} /> },
  { role: 'sent', view: 'sent', label: 'Sent', icon: <Send size={15} /> },
  { role: 'archive', view: 'archive', label: 'Archive', icon: <Archive size={15} /> },
  { role: 'spam', view: 'spam', label: 'Spam', icon: <ShieldAlert size={15} /> },
  { role: 'trash', view: 'trash', label: 'Trash', icon: <Trash2 size={15} /> }
]

const EMPTY: Partial<Record<string, string>> = {
  inbox: 'Inbox zero 🎉',
  followups: 'Nothing needs follow-up right now. Emails show up here when someone has waited a day for your reply, or you for theirs.',
  drafts: 'No drafts.',
  spam: 'No spam.',
  trash: 'Trash is empty.'
}

export function InboxPage({ view }: { view?: 'clients' } = {}) {
  const [params, setParams] = useSearchParams()
  const folder = (params.get('folder') as MailFolder) || 'inbox'
  const threadId = params.get('thread')
  const accountId = params.get('account')
  const category = (params.get('cat') as EmailCategory | null) || null
  const fuKind = (params.get('kind') as 'reply' | 'nudge' | null) || null
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const { data: accounts = [] } = useAccounts()
  const mailAccounts = accounts.filter((a) => a.kind === 'mail')
  useEffect(() => {
    const h = setTimeout(() => setQ(search), 250)
    return () => clearTimeout(h)
  }, [search])
  const { data: threads = [], isLoading } = useQuery({
    queryKey: ['threads', folder, accountId, q, category, fuKind],
    queryFn: () => api.listThreads({ folder, account_id: accountId, search: q || undefined, ai_category: category, followup_kind: folder === 'followups' ? fuKind : null }),
    placeholderData: (p) => p,
    enabled: view !== 'clients'
  })
  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    if (k !== 'thread') next.delete('thread')
    if (k === 'folder') next.delete('cat'), next.delete('kind')
    setParams(next, { replace: true })
  }

  if (!mailAccounts.length && view !== 'clients')
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-sm text-center">
          <Mail size={36} className="mx-auto mb-3 text-muted" />
          <h1 className="text-lg font-semibold">Connect your email</h1>
          <p className="mt-1 mb-4 text-muted">Add your email account: type your address and FollowUp finds the right settings.</p>
          <Button variant="primary" onClick={() => (window.location.hash = '#/settings')}>Open Settings → Accounts</Button>
        </div>
      </div>
    )

  return (
    <div className="flex h-full">
      <ResizablePanel id="inbox.folders" initial={200} min={150} max={340} label="Resize the folder list" className="h-full">
        <FolderColumn
          folder={view === 'clients' ? null : folder}
          accountId={accountId}
          onFolder={(f) => {
            if (view === 'clients') window.location.hash = `#/inbox?folder=${encodeURIComponent(f)}`
            else setParam('folder', f)
          }}
          onAccount={(a) => setParam('account', a)}
        />
      </ResizablePanel>

      {view === 'clients' ? (
        <div className="min-w-0 flex-1">
          <ClientsView />
        </div>
      ) : (
        <>
          <ResizablePanel id="inbox.list" initial={380} min={260} max={720} label="Resize the email list" className="h-full">
            <section className="flex h-full flex-col border-r border-line">
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
              {folder === 'followups' && <FollowUpTabs kind={fuKind} onKind={(k) => setParam('kind', k)} />}
              {folder !== 'followups' && (category || threads.some((t) => t.ai)) && (
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
                {!isLoading && threads.length === 0 && <Empty>{q ? 'No matches.' : (EMPTY[folder] ?? 'Nothing here.')}</Empty>}
                {threads.map((t) => (
                  <ThreadRow key={t.id} t={t} active={t.id === threadId} showFollowUp={folder === 'followups'} onClick={() => setParam('thread', t.id)} />
                ))}
              </div>
            </section>
          </ResizablePanel>

          <main className="min-w-0 flex-1 overflow-hidden">
            {threadId ? <ThreadView key={threadId} id={threadId} folder={folder} onClose={() => setParam('thread', null)} /> : <Empty>Select an email to read it.</Empty>}
          </main>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- folder column

function FolderColumn({
  folder,
  accountId,
  onFolder,
  onAccount
}: {
  folder: MailFolder | null
  accountId: string | null
  onFolder: (f: string) => void
  onAccount: (a: string | null) => void
}) {
  const openCompose = useUi((s) => s.openCompose)
  const { data: unread = 0 } = useUnreadCount()
  const { data: fu } = useFollowUpCounts()
  const { data: folders = [] } = useMailFolders()
  const { data: accounts = [] } = useAccounts()
  const mailAccounts = accounts.filter((a) => a.kind === 'mail')
  const roles = new Set(folders.map((f) => f.role))
  const custom = folders.filter((f) => !f.role && (!accountId || f.account_id === accountId))
  const isClients = folder === null

  const item = (id: string, label: string, icon: React.ReactNode, badge?: number, onClick?: () => void, active?: boolean, depth = 0) => (
    <button
      key={id}
      type="button"
      onClick={onClick ?? (() => onFolder(id))}
      className={cn('flex h-8 w-full shrink-0 items-center gap-2.5 rounded-md px-2.5 text-left hover:bg-hover', (active ?? folder === id) && 'bg-hover font-medium')}
      style={depth ? { paddingLeft: 10 + depth * 12 } : undefined}
    >
      <span className="text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {!!badge && <span className="text-xs font-semibold text-accent">{badge}</span>}
    </button>
  )

  return (
    <aside className="flex h-full flex-col overflow-y-auto border-r border-line bg-panel p-2">
      <Button variant="primary" className="mb-3 shrink-0 justify-center" onClick={() => openCompose()}>
        <PenSquare size={14} /> Compose
      </Button>
      {item('inbox', 'Inbox', <Inbox size={15} />, unread)}
      {item('followups', 'Follow-up', <Clock size={15} />, (fu?.reply ?? 0) + (fu?.nudge ?? 0))}
      {item('clients', 'Clients', <Building2 size={15} />, undefined, () => (window.location.hash = '#/clients'), isClients)}

      <div className="mt-3 mb-1 shrink-0 px-2.5 text-[11px] font-medium tracking-wide text-muted uppercase">Mail</div>
      {ROLE_VIEWS.filter((r) => roles.has(r.role) || (r.role === 'archive' && roles.has('all')) || r.role === 'sent').map((r) => item(r.view, r.label, r.icon))}
      {item('done', 'Done', <ArchiveRestore size={15} />)}
      {item('all', 'All mail', <Mail size={15} />)}

      {custom.length > 0 && (
        <>
          <div className="mt-3 mb-1 shrink-0 px-2.5 text-[11px] font-medium tracking-wide text-muted uppercase">Folders</div>
          {custom.map((f) =>
            item(
              `folder:${f.account_id}|${f.path}`,
              mailAccounts.length > 1 && !accountId ? `${f.name} · ${mailAccounts.find((a) => a.id === f.account_id)?.email.split('@')[0] ?? ''}` : f.name,
              <Folder size={15} />,
              f.unread,
              undefined,
              undefined,
              f.depth
            )
          )}
        </>
      )}

      {mailAccounts.length > 1 && (
        <Select value={accountId ?? ''} onChange={(e) => onAccount(e.target.value || null)} className="mt-4 shrink-0" aria-label="Account">
          <option value="">All accounts</option>
          {mailAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.email}</option>
          ))}
        </Select>
      )}
    </aside>
  )
}

function FollowUpTabs({ kind, onKind }: { kind: 'reply' | 'nudge' | null; onKind: (k: string | null) => void }) {
  const { data: c } = useFollowUpCounts()
  const tab = (k: 'reply' | 'nudge' | null, label: string, n?: number, hint?: string) => (
    <button
      type="button"
      title={hint}
      onClick={() => onKind(k)}
      className={cn('flex-1 rounded-md px-2 py-1.5 text-xs', kind === k ? 'bg-accent/10 font-medium text-accent' : 'text-muted hover:bg-hover hover:text-fg')}
    >
      {label} {n !== undefined && <span className="tabular-nums">({n})</span>}
    </button>
  )
  return (
    <div className="flex gap-1 border-b border-line p-1.5">
      {tab(null, 'All', (c?.reply ?? 0) + (c?.nudge ?? 0))}
      {tab('reply', 'Reply needed', c?.reply, 'They wrote and nobody on your side has answered')}
      {tab('nudge', 'Waiting on them', c?.nudge, 'You wrote and they haven’t answered')}
    </div>
  )
}

function ThreadRow({ t, active, showFollowUp, onClick }: { t: MailThread; active: boolean; showFollowUp: boolean; onClick: () => void }) {
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
      {showFollowUp && t.followup ? (
        <div className="truncate text-xs text-amber-700 dark:text-amber-300">{waitingText(t.followup)}</div>
      ) : (
        <div className="truncate text-xs text-muted">{t.snippet}</div>
      )}
      {(t.task_ids.length > 0 || t.ai || t.company || (!showFollowUp && t.followup?.due)) && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {t.ai && <CategoryChip ai={t.ai} />}
          {t.company && <CompanyChip c={t.company} />}
          {!showFollowUp && t.followup?.due && <FollowUpBadge f={t.followup} />}
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

export function CompanyChip({ c }: { c: NonNullable<MailThread['company']> }) {
  return (
    <span className="inline-flex max-w-48 items-center gap-1 rounded border border-line px-1.5 text-[11px] text-muted" title={c.stage ? `${c.name} · ${c.stage}` : c.name}>
      <Building2 size={10} />
      <span className="truncate">{c.name}</span>
      {c.stage && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.color ?? 'currentColor' }} />}
    </span>
  )
}

// ---------------------------------------------------------------- reading pane

function ThreadView({ id, folder, onClose }: { id: string; folder: MailFolder; onClose: () => void }) {
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
  const sent = thread.messages.filter((m) => !m.is_draft)
  const last = sent.at(-1) ?? thread.messages.at(-1)!
  const lastInbound = [...sent].reverse().find((m) => !m.is_outbound) ?? last

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
            {thread.company && (
              <span className="ml-2 align-middle">
                <CompanyChip c={thread.company} />
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
          <span className="mx-1 h-5 w-px bg-line" />
          <FolderActions thread={thread} folder={folder} onGone={onClose} />
          <Button size="sm" variant="ghost" onClick={() => api.markThreadRead(thread.id, false)}>
            <MailOpen size={13} /> Mark unread
          </Button>
          <ThreadAi thread={thread} lastInbound={lastInbound} />
        </div>
        <LinkedTasks taskIds={thread.task_ids} threadId={thread.id} />
      </header>

      <div className="flex-1 space-y-3 overflow-auto px-5 py-4">
        {thread.followup && <FollowUpPanel thread={thread} autoDraft={folder === 'followups'} />}
        {thread.messages.map((m, i) => {
          const open = i === thread.messages.length - 1 || !m.is_read || expanded.has(m.id) || m.is_draft
          return (
            <MessageCard
              key={m.id}
              m={m}
              thread={thread}
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

/** Archive / Spam / Delete / Restore / Move, depending on where the conversation is. */
function FolderActions({ thread, folder, onGone }: { thread: ThreadDetail; folder: MailFolder; onGone: () => void }) {
  const { data: folders = [] } = useMailFolders()
  const roles = new Set(thread.locations.map((l) => l.role))
  const mine = folders.filter((f) => f.account_id === thread.account_id)
  const has = (r: FolderRole) => mine.some((f) => f.role === r) || (r === 'archive' && mine.some((f) => f.role === 'all'))
  // the folder the action applies to: the one being viewed, else the inbox, else wherever it is
  const viewing = folder.startsWith('folder:') ? `folder:${folder.slice(7).split('|')[1]}` : (['spam', 'trash', 'drafts', 'sent', 'archive'] as string[]).includes(folder) ? folder : null
  const first = thread.locations[0]
  const from = viewing ?? (roles.has('inbox') ? 'inbox' : first ? (first.role && first.role !== 'all' ? first.role : `folder:${first.path}`) : null)
  const move = async (to: string, done: string) => {
    if (!from) return
    await api.moveThread(thread.id, from, to)
    toast(done, 'success')
    onGone()
  }
  const inBin = from === 'spam' || from === 'trash'
  return (
    <>
      {!inBin && (
        <Button size="sm" variant="ghost" onClick={() => api.setThreadDone(thread.id, !thread.done)} title="Done hides it from your Inbox in FollowUp only">
          {thread.done ? <ArchiveRestore size={13} /> : <CheckSquare size={13} />} {thread.done ? 'Not done' : 'Done'}
        </Button>
      )}
      {from === 'inbox' && has('archive') && (
        <Button size="sm" variant="ghost" onClick={() => move('archive', 'Archived')}>
          <Archive size={13} /> Archive
        </Button>
      )}
      {from && !inBin && from !== 'drafts' && has('spam') && (
        <Button size="sm" variant="ghost" onClick={() => move('spam', 'Moved to Spam')}>
          <ShieldAlert size={13} /> Spam
        </Button>
      )}
      {from === 'spam' && (
        <Button size="sm" variant="ghost" onClick={() => move('inbox', 'Moved to Inbox')}>
          <ShieldCheck size={13} /> Not spam
        </Button>
      )}
      {from === 'trash' && (
        <Button size="sm" variant="ghost" onClick={() => move('inbox', 'Restored to Inbox')}>
          <RotateCcw size={13} /> Restore
        </Button>
      )}
      {from && !inBin && has('trash') && (
        <Button size="sm" variant="ghost" onClick={() => move('trash', 'Moved to Trash')}>
          <Trash2 size={13} /> Delete
        </Button>
      )}
      {inBin && (
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            if (!window.confirm('Delete this conversation for good? It is removed from the server too and can’t be recovered.')) return
            await api.deleteThreadForever(thread.id)
            onGone()
          }}
        >
          <Trash2 size={13} /> Delete forever
        </Button>
      )}
      {from && mine.length > 0 && <MoveMenu folders={mine} from={from} onMove={(to, name) => move(to, `Moved to ${name}`)} />}
    </>
  )
}

function MoveMenu({ folders, from, onMove }: { folders: MailFolderInfo[]; from: string; onMove: (to: string, name: string) => void }) {
  const fromPath = from.startsWith('folder:') ? from.slice(7) : folders.find((f) => f.role === from)?.path
  const targets = useMemo(() => folders.filter((f) => f.path !== fromPath && f.role !== 'drafts' && f.role !== 'sent'), [folders, fromPath])
  return (
    <Popover
      trigger={
        <Button size="sm" variant="ghost">
          <FolderInput size={13} /> Move <ChevronDown size={12} />
        </Button>
      }
    >
      {(close) => (
        <div className="max-h-80 w-56 overflow-auto">
          {targets.map((f, i) => (
            <div key={f.path}>
              {i > 0 && !f.role && targets[i - 1].role && <MenuSeparator />}
              <MenuItem onClick={() => (close(), onMove(f.role && f.role !== 'all' ? f.role : `folder:${f.path}`, f.name))}>
                <span style={{ paddingLeft: f.depth * 10 }}>{f.role === 'all' ? 'All mail (archive)' : f.name}</span>
              </MenuItem>
            </div>
          ))}
        </div>
      )}
    </Popover>
  )
}

function MessageCard({ m, thread, open, onToggle }: { m: MailMessage; thread: ThreadDetail; open: boolean; onToggle: () => void }) {
  const openCompose = useUi((s) => s.openCompose)
  return (
    <article className={cn('rounded-xl border border-line bg-panel', m.is_outbound && 'border-accent/30', m.is_draft && 'border-dashed border-amber-500/60')}>
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white', m.is_outbound ? 'bg-accent' : 'bg-slate-400')}>
          {(m.from.name || m.from.address)[0]?.toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            <span className="font-semibold">{m.is_draft ? 'Draft' : m.is_outbound ? 'You' : m.from.name || m.from.address}</span>
            {!m.is_outbound && m.from.name && <span className="ml-1.5 text-xs text-muted">&lt;{m.from.address}&gt;</span>}
          </span>
          <span className="block truncate text-xs text-muted">
            {open ? `to ${m.to.map((t) => t.name || t.address).join(', ') || '(no recipient yet)'}${m.cc.length ? `, cc ${m.cc.map((c) => c.address).join(', ')}` : ''}` : m.snippet}
          </span>
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
          {m.is_draft && (
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  openCompose({
                    account_id: thread.account_id,
                    to: m.to.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', '),
                    cc: m.cc.map((a) => a.address).join(', '),
                    subject: m.subject,
                    body: m.body_text,
                    reply_to: thread.messages.filter((x) => !x.is_draft).at(-1)?.id ?? null,
                    draft_id: m.id
                  })
                }
              >
                <PenSquare size={13} /> Edit draft
              </Button>
              <Button size="sm" variant="ghost" onClick={() => window.confirm('Discard this draft?') && api.discardDraft(m.id)}>
                <Trash2 size={13} /> Discard
              </Button>
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
