import { useEffect, useState } from 'react'
import { ChevronDown, Loader2, Sparkles } from 'lucide-react'
import type { Priority } from '@shared/types'
import { api } from '@/lib/api'
import { useAiReady, useTags, useTreeMaps } from '@/lib/hooks'
import { toast, useUi } from '@/stores/ui'
import { Button, Dot, IconButton, Modal } from '@/components/ui'
import { DateField, ListPicker, PriorityPicker, TagList, TagPicker } from './pickers'

const LAST_LIST_KEY = 'quickadd:lastList'

export function QuickAdd() {
  const defaults = useUi((s) => s.quickAdd)
  const close = useUi((s) => s.closeQuickAdd)
  const openTask = useUi((s) => s.openTask)
  const maps = useTreeMaps()
  const [title, setTitle] = useState('')
  const [listId, setListId] = useState<string | undefined>()
  const [priority, setPriority] = useState<Priority>('none')
  const [due, setDue] = useState<string | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [parsing, setParsing] = useState(false)
  const aiReady = useAiReady()
  const { data: allTags = [] } = useTags()

  useEffect(() => {
    if (!defaults || !maps) return
    let remembered: string | null = null
    try {
      remembered = localStorage.getItem(LAST_LIST_KEY)
    } catch {
      /* storage unavailable */
    }
    setTitle(defaults.title ?? '')
    const context = useUi.getState().contextListId
    setListId(
      defaults.list_id ??
        (context && maps.list.has(context) ? context : remembered && maps.list.has(remembered) ? remembered : maps.lists[0]?.id)
    )
    setPriority(defaults.priority ?? 'none')
    setDue(defaults.due_date ?? null)
    setTags(defaults.tag_ids ?? [])
  }, [defaults, maps])

  if (!defaults || !maps) return null
  const list = listId ? maps.list.get(listId) : undefined
  const space = list ? maps.space.get(list.space_id) : undefined

  const submit = async (open: boolean) => {
    if (!title.trim() || !listId) return
    const task = await api.createTask({
      sprint_id: useUi.getState().contextSprintId ?? undefined,
      ...defaults,
      list_id: listId,
      title,
      priority,
      due_date: due,
      tag_ids: tags
    })
    try {
      localStorage.setItem(LAST_LIST_KEY, listId)
    } catch {
      /* storage unavailable */
    }
    close()
    if (open) openTask(task.id)
    else toast(`Created “${task.title}”`, 'success')
  }

  /** Let AI turn "call Sam next Tue 3pm !high #sales" into title, due date, priority and tags. */
  const parse = async () => {
    if (!title.trim() || parsing) return
    setParsing(true)
    try {
      const r = await api.aiParseQuickAdd(title)
      setTitle(r.title)
      if (r.due_date) setDue(r.due_date)
      if (r.priority !== 'none') setPriority(r.priority)
      const ids = [...tags]
      for (const name of r.tags) {
        const existing = allTags.find((t) => t.name.toLowerCase() === name.toLowerCase())
        const id = existing?.id ?? (await api.createTag({ name })).id
        if (!ids.includes(id)) ids.push(id)
      }
      setTags(ids)
    } catch {
      /* shown as a toast */
    } finally {
      setParsing(false)
    }
  }

  return (
    <Modal
      title="New task"
      onClose={close}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={() => submit(true)} disabled={!title.trim() || !listId}>
            Create & open
          </Button>
          <Button variant="primary" onClick={() => submit(false)} disabled={!title.trim() || !listId}>
            Create task
          </Button>
        </>
      }
    >
      {maps.lists.length === 0 ? (
        <p className="text-muted">Create a list in the sidebar first.</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.altKey && aiReady) {
                  e.preventDefault()
                  void parse()
                } else if (e.key === 'Enter') void submit(e.ctrlKey)
              }}
              placeholder={aiReady ? 'Task name, or e.g. “Call Sam next Tue 3pm, urgent #sales”' : 'Task name'}
              className="min-w-0 flex-1 bg-transparent text-[17px] font-medium outline-none placeholder:text-muted placeholder:font-normal placeholder:text-[14px]"
            />
            {aiReady && (
              <IconButton label="Fill in date, priority and tags with AI (Alt+Enter)" className="text-accent" disabled={!title.trim() || parsing} onClick={parse}>
                {parsing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              </IconButton>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <ListPicker
              value={listId}
              onChange={setListId}
              trigger={
                <Button size="sm">
                  {space && <Dot color={space.color} />}
                  {list?.name ?? 'Choose list'} <ChevronDown size={13} />
                </Button>
              }
            />
            <span className="inline-flex h-7 items-center rounded-md border border-line px-2">
              <PriorityPicker value={priority} onChange={setPriority} showLabel />
            </span>
            <span className="inline-flex h-7 items-center rounded-md border border-line px-2">
              <DateField value={due} onChange={setDue} placeholder="Due date" />
            </span>
            <span className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2">
              <TagList ids={tags} onChange={setTags} />
              <TagPicker value={tags} onChange={setTags} />
            </span>
          </div>
          <p className="mt-4 text-xs text-muted">Enter to create · Ctrl+Enter to create and open{aiReady && ' · Alt+Enter to fill in details with AI'}</p>
        </>
      )}
    </Modal>
  )
}
