import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, MessageSquare, Sparkles, X } from 'lucide-react'
import type { RewriteStyle } from '@shared/ai'
import type { TaskDetail } from '@shared/types'
import { api } from '@/lib/api'
import { useAiReady } from '@/lib/hooks'
import { toast, useUi } from '@/stores/ui'
import { Button, IconButton, MenuItem, MenuSeparator, Popover } from '@/components/ui'
import { Markdown } from './Markdown'

export type TaskAiResult =
  | { kind: 'loading'; label: string }
  | { kind: 'summary'; summary: string; next_steps: string[] }
  | { kind: 'subtasks'; items: string[] }
  | { kind: 'rewrite'; text: string; style: RewriteStyle }

const REWRITE: [RewriteStyle, string][] = [
  ['clearer', 'Make clearer'],
  ['shorter', 'Make shorter'],
  ['friendlier', 'Make friendlier'],
  ['formal', 'Make more formal'],
  ['fix_grammar', 'Fix spelling & grammar']
]

export const htmlToText = (html: string): string => {
  const doc = new DOMParser().parseFromString(html.replace(/<\/(p|li|h\d|blockquote)>/g, '$&\n').replace(/<br\s*\/?>/g, '\n'), 'text/html')
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const textToHtml = (text: string): string =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('')

/** The ✨ menu in the task panel header. */
export function TaskAiMenu({ task, onResult }: { task: TaskDetail; onResult: (r: TaskAiResult | null) => void }) {
  const ready = useAiReady()
  const navigate = useNavigate()
  const run = async <T,>(label: string, fn: () => Promise<T>, toResult: (v: T) => TaskAiResult) => {
    onResult({ kind: 'loading', label })
    try {
      onResult(toResult(await fn()))
    } catch {
      onResult(null) // the error is already shown as a toast
    }
  }
  const description = htmlToText(task.description)
  return (
    <Popover
      align="end"
      className="w-56"
      trigger={
        <IconButton label="AI" className="text-accent">
          <Sparkles size={15} />
        </IconButton>
      }
    >
      {(close) =>
        !ready ? (
          <MenuItem icon={<Sparkles size={14} />} onClick={() => (close(), useUi.getState().openTask(null), navigate('/settings#ai'))}>
            Set up AI in Settings…
          </MenuItem>
        ) : (
          <>
            <MenuItem
              onClick={() => (close(), run('Summarizing…', () => api.aiSummarizeTask(task.id), (r) => ({ kind: 'summary', ...r })))}
            >
              Summarize task
            </MenuItem>
            <MenuItem onClick={() => (close(), run('Suggesting subtasks…', () => api.aiSuggestSubtasks(task.id), (items) => ({ kind: 'subtasks', items })))}>
              Suggest subtasks
            </MenuItem>
            {description && (
              <>
                <MenuSeparator />
                <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted">Rewrite description</div>
                {REWRITE.map(([style, label]) => (
                  <MenuItem key={style} onClick={() => (close(), run('Rewriting…', () => api.aiRewrite(description, style), (text) => ({ kind: 'rewrite', text, style })))}>
                    {label}
                  </MenuItem>
                ))}
              </>
            )}
            <MenuSeparator />
            <MenuItem
              icon={<MessageSquare size={14} />}
              onClick={() => {
                close()
                useUi.getState().openAssistant({ chatId: null, prefill: `About the task “${task.title}” (id ${task.id}): ` })
              }}
            >
              Ask the assistant…
            </MenuItem>
          </>
        )
      }
    </Popover>
  )
}

/** Shows what the ✨ menu produced, with ways to apply it. */
export function TaskAiCard({ task, result, onClose }: { task: TaskDetail; result: TaskAiResult; onClose: () => void }) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(result.kind === 'subtasks' ? result.items.map((_, i) => i) : []))
  return (
    <div className="mt-5 rounded-lg border border-accent/40 bg-accent/5 px-4 py-3 text-[13px]">
      <div className="mb-1.5 flex items-center gap-2">
        <Sparkles size={14} className="text-accent" />
        <span className="flex-1 font-medium">
          {result.kind === 'loading' ? result.label : result.kind === 'summary' ? 'Summary' : result.kind === 'subtasks' ? 'Suggested subtasks' : 'Rewritten description'}
        </span>
        {result.kind !== 'loading' && (
          <IconButton label="Dismiss" className="h-6 w-6" onClick={onClose}>
            <X size={14} />
          </IconButton>
        )}
      </div>
      {result.kind === 'loading' && <Loader2 size={16} className="animate-spin text-muted" />}

      {result.kind === 'summary' && (
        <>
          <Markdown text={result.summary} />
          {result.next_steps.length > 0 && (
            <>
              <div className="mt-2 text-xs font-medium text-muted">Next steps</div>
              <ul className="list-disc pl-5">
                {result.next_steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              onClick={async () => {
                const steps = result.next_steps.length ? `\n\nNext steps:\n${result.next_steps.map((s) => `- ${s}`).join('\n')}` : ''
                await api.addComment(task.id, `AI summary: ${result.summary}${steps}`)
                toast('Added as a comment', 'success')
                onClose()
              }}
            >
              Add as comment
            </Button>
          </div>
        </>
      )}

      {result.kind === 'subtasks' && (
        <>
          {result.items.length === 0 && <p className="text-muted">No suggestions — the task already looks well broken down.</p>}
          <ul className="space-y-1">
            {result.items.map((s, i) => (
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
                  {s}
                </label>
              </li>
            ))}
          </ul>
          {result.items.length > 0 && (
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                variant="primary"
                disabled={!picked.size}
                onClick={async () => {
                  for (const i of [...picked].sort((a, b) => a - b)) await api.createTask({ list_id: task.list_id, parent_id: task.id, title: result.items[i] })
                  toast(`Added ${picked.size} subtask${picked.size === 1 ? '' : 's'}`, 'success')
                  onClose()
                }}
              >
                Add {picked.size} subtask{picked.size === 1 ? '' : 's'}
              </Button>
            </div>
          )}
        </>
      )}

      {result.kind === 'rewrite' && (
        <>
          <p className="whitespace-pre-wrap select-text">{result.text}</p>
          <p className="mt-2 text-xs text-muted">Replacing keeps the text but removes formatting such as lists and links.</p>
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" onClick={onClose}>Discard</Button>
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                await api.updateTask(task.id, { description: textToHtml(result.text) })
                onClose()
              }}
            >
              Replace description
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
