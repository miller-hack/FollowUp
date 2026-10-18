import { useState } from 'react'
import { ChevronDown, Loader2, Sparkles, X } from 'lucide-react'
import { EMAIL_CATEGORY_LABEL, type EmailCategory } from '@shared/ai'
import type { MailMessage, MailThread, ThreadDetail } from '@shared/mail'
import { api } from '@/lib/api'
import { useAccounts, useAiReady, useTreeMaps } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { toast, useUi } from '@/stores/ui'
import { Button, IconButton, MenuItem, Popover } from '@/components/ui'
import { replyDraft } from '../mail/Compose'
import { ListPicker } from '../tasks/pickers'
import { Markdown } from './Markdown'

export const CATEGORY_STYLE: Record<EmailCategory, string> = {
  action: 'bg-red-500/12 text-red-600 dark:text-red-400',
  reply: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  fyi: 'bg-sky-500/12 text-sky-700 dark:text-sky-300',
  newsletter: 'bg-violet-500/12 text-violet-700 dark:text-violet-300',
  notification: 'bg-slate-500/12 text-slate-600 dark:text-slate-300',
  spam: 'bg-hover text-muted line-through'
}

export function CategoryChip({ ai }: { ai: NonNullable<MailThread['ai']> }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 text-[11px]', CATEGORY_STYLE[ai.category])} title={ai.summary}>
      {ai.priority === 1 && <span aria-label="High priority">!</span>}
      {EMAIL_CATEGORY_LABEL[ai.category]}
    </span>
  )
}

type Result =
  | { kind: 'loading'; label: string }
  | { kind: 'summary'; summary: string; action_items: string[] }
  | { kind: 'tasks'; items: { title: string; due_date: string | null }[] }
  | { kind: 'draft' }

/** ✨ AI button + result card for an open email thread. */
export function ThreadAi({ thread, lastInbound }: { thread: ThreadDetail; lastInbound: MailMessage }) {
  const ready = useAiReady()
  const [result, setResult] = useState<Result | null>(null)
  const run = async <T,>(label: string, fn: () => Promise<T>, done: (v: T) => Result | null) => {
    setResult({ kind: 'loading', label })
    try {
      setResult(done(await fn()))
    } catch {
      setResult(null)
    }
  }
  if (!ready) return null
  return (
    <>
      <Popover
        className="w-56"
        trigger={
          <Button size="sm">
            <Sparkles size={13} className="text-accent" /> AI <ChevronDown size={12} />
          </Button>
        }
      >
        {(close) => (
          <>
            <MenuItem onClick={() => (close(), run('Summarizing…', () => api.aiSummarizeThread(thread.id), (r) => ({ kind: 'summary', ...r })))}>
              Summarize thread
            </MenuItem>
            <MenuItem onClick={() => (close(), setResult({ kind: 'draft' }))}>Draft a reply…</MenuItem>
            <MenuItem onClick={() => (close(), run('Looking for tasks…', () => api.aiExtractTasks(thread.id), (items) => ({ kind: 'tasks', items })))}>
              Find tasks in this email
            </MenuItem>
            <MenuItem
              onClick={() => {
                close()
                void api.aiTriageThread(thread.id).then(
                  (r) => toast(`Sorted as “${EMAIL_CATEGORY_LABEL[r.category]}”`, 'success'),
                  () => undefined
                )
              }}
            >
              {thread.ai ? 'Sort again' : 'Sort this email'}
            </MenuItem>
          </>
        )}
      </Popover>
      {result && (
        <div className="mt-2 w-full basis-full rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-[13px]">
          <div className="mb-1 flex items-center gap-2">
            <Sparkles size={13} className="text-accent" />
            <span className="flex-1 font-medium">
              {result.kind === 'loading' ? result.label : result.kind === 'summary' ? 'Summary' : result.kind === 'tasks' ? 'Tasks found' : 'Draft a reply'}
            </span>
            {result.kind !== 'loading' && (
              <IconButton label="Dismiss" className="h-6 w-6" onClick={() => setResult(null)}>
                <X size={13} />
              </IconButton>
            )}
          </div>
          {result.kind === 'loading' && <Loader2 size={15} className="animate-spin text-muted" />}
          {result.kind === 'summary' && (
            <div className="select-text">
              <Markdown text={result.summary} />
              {result.action_items.length > 0 && (
                <>
                  <div className="mt-2 text-xs font-medium text-muted">Action items</div>
                  <ul className="list-disc pl-5">
                    {result.action_items.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          {result.kind === 'draft' && <DraftForm thread={thread} lastInbound={lastInbound} onDone={() => setResult(null)} />}
          {result.kind === 'tasks' && <TaskPicker thread={thread} items={result.items} onDone={() => setResult(null)} />}
        </div>
      )}
    </>
  )
}

function DraftForm({ thread, lastInbound, onDone }: { thread: ThreadDetail; lastInbound: MailMessage; onDone: () => void }) {
  const { data: accounts = [] } = useAccounts()
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)
  const account = accounts.find((a) => a.id === thread.account_id)
  const draft = async () => {
    setBusy(true)
    try {
      const body = await api.aiDraftReply(thread.id, instructions, account?.name ?? '')
      const base = replyDraft(thread, lastInbound, false, account?.email ?? '')
      useUi.getState().openCompose({ ...base, body: `${body}${base.body}` })
      onDone()
    } catch {
      /* shown as a toast */
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex gap-2">
      <input
        autoFocus
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !busy && void draft()}
        placeholder="What should it say? e.g. “accept, propose Thursday 2pm” (optional)"
        className="h-8 flex-1 rounded-md border border-line bg-panel px-2 outline-none focus:border-accent"
      />
      <Button variant="primary" disabled={busy} onClick={draft}>
        {busy && <Loader2 size={13} className="animate-spin" />} Write draft
      </Button>
    </div>
  )
}

function TaskPicker({ thread, items, onDone }: { thread: ThreadDetail; items: { title: string; due_date: string | null }[]; onDone: () => void }) {
  const maps = useTreeMaps()
  const [picked, setPicked] = useState<Set<number>>(() => new Set(items.map((_, i) => i)))
  const [listId, setListId] = useState<string | undefined>(() => useUi.getState().contextListId ?? maps?.lists[0]?.id)
  if (!items.length) return <p className="text-muted">No to-dos found in this email.</p>
  const list = listId ? maps?.list.get(listId) : undefined
  return (
    <>
      <ul className="space-y-1">
        {items.map((t, i) => (
          <li key={i}>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={picked.has(i)}
                onChange={() => {
                  const next = new Set(picked)
                  if (next.has(i)) next.delete(i)
                  else next.add(i)
                  setPicked(next)
                }}
              />
              <span>
                {t.title}
                {t.due_date && <span className="ml-1.5 text-xs text-muted">due {t.due_date.replace('T', ' ')}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-end gap-2">
        <span className="text-xs text-muted">in</span>
        <ListPicker
          value={listId}
          onChange={setListId}
          trigger={
            <Button size="sm">
              {list?.name ?? 'Choose list'} <ChevronDown size={12} />
            </Button>
          }
        />
        <Button
          size="sm"
          variant="primary"
          disabled={!picked.size || !listId}
          onClick={async () => {
            for (const i of [...picked].sort((a, b) => a - b)) {
              const task = await api.createTask({ list_id: listId!, title: items[i].title, due_date: items[i].due_date })
              await api.linkThreadTask(thread.id, task.id)
            }
            toast(`Created ${picked.size} task${picked.size === 1 ? '' : 's'}`, 'success')
            onDone()
          }}
        >
          Create {picked.size} task{picked.size === 1 ? '' : 's'}
        </Button>
      </div>
    </>
  )
}
