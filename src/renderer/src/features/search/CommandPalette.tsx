import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Home, Inbox, Mail, LayoutDashboard, List as ListIcon, Moon, Plus, Search, Settings, Square, Target, Timer } from 'lucide-react'
import type { TaskRef } from '@shared/types'
import { api } from '@/lib/api'
import { useSettings, useTreeMaps } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'

interface Item {
  id: string
  group: string
  label: string
  hint?: string
  icon: ReactNode
  run: () => void
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen)
  const setOpen = useUi((s) => s.setPalette)
  if (!open) return null
  return createPortal(<Palette close={() => setOpen(false)} />, document.body)
}

function Palette({ close }: { close: () => void }) {
  const navigate = useNavigate()
  const maps = useTreeMaps()
  const { data: settings } = useSettings()
  const openTask = useUi((s) => s.openTask)
  const openQuickAdd = useUi((s) => s.openQuickAdd)
  const [q, setQ] = useState('')
  const [tasks, setTasks] = useState<TaskRef[]>([])
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!q.trim()) return setTasks([])
    const h = setTimeout(async () => setTasks((await api.search(q)).tasks), 120)
    return () => clearTimeout(h)
  }, [q])

  const items = useMemo<Item[]>(() => {
    const ql = q.trim().toLowerCase()
    const match = (s: string) => !ql || s.toLowerCase().includes(ql)
    const go = (fn: () => void) => () => (close(), fn())
    const commands: Item[] = [
      { id: 'new', group: 'Commands', label: 'New task', hint: 'Ctrl+N', icon: <Plus size={15} />, run: go(() => openQuickAdd()) },
      { id: 'home', group: 'Commands', label: 'Go to Home', icon: <Home size={15} />, run: go(() => navigate('/')) },
      { id: 'compose', group: 'Commands', label: 'Compose email', icon: <Mail size={15} />, run: go(() => useUi.getState().openCompose()) },
      { id: 'inbox', group: 'Commands', label: 'Go to Inbox', icon: <Inbox size={15} />, run: go(() => navigate('/inbox')) },
      { id: 'calendar', group: 'Commands', label: 'Go to Calendar', icon: <CalendarDays size={15} />, run: go(() => navigate('/calendar')) },
      { id: 'settings', group: 'Commands', label: 'Open Settings', icon: <Settings size={15} />, run: go(() => navigate('/settings')) },
      { id: 'dash', group: 'Commands', label: 'Go to Dashboards', icon: <LayoutDashboard size={15} />, run: go(() => navigate('/dashboards')) },
      { id: 'goals', group: 'Commands', label: 'Go to Goals', icon: <Target size={15} />, run: go(() => navigate('/goals')) },
      { id: 'time', group: 'Commands', label: 'Go to Time tracking', icon: <Timer size={15} />, run: go(() => navigate('/time')) },
      { id: 'stop', group: 'Commands', label: 'Stop running timer', icon: <Square size={15} />, run: go(() => void api.stopTimer()) },
      {
        id: 'theme',
        group: 'Commands',
        label: 'Toggle dark mode',
        icon: <Moon size={15} />,
        run: go(() => {
          const dark = document.documentElement.classList.contains('dark')
          void api.updateSettings({ theme: dark ? 'light' : 'dark' })
        })
      }
    ].filter((c) => match(c.label))
    const lists: Item[] = (maps?.lists ?? [])
      .filter((l) => ql && match(l.name))
      .slice(0, 6)
      .map((l) => ({
        id: `list:${l.id}`,
        group: 'Lists',
        label: l.name,
        hint: maps?.space.get(l.space_id)?.name,
        icon: <ListIcon size={15} />,
        run: go(() => navigate(`/l/list/${l.id}`))
      }))
    const taskItems: Item[] = tasks.map((t) => ({
      id: `task:${t.id}`,
      group: 'Tasks',
      label: t.title,
      hint: maps?.list.get(t.list_id)?.name,
      icon: <CheckCircle2 size={15} style={{ color: maps?.status.get(t.status_id)?.color }} />,
      run: go(() => openTask(t.id))
    }))
    return [...taskItems, ...lists, ...commands]
  }, [q, tasks, maps, close, navigate, openQuickAdd, openTask, settings])

  useEffect(() => setActive(0), [q, tasks.length])
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  let lastGroup = ''
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[14vh]" onMouseDown={close}>
      <div className="w-[600px] overflow-hidden rounded-xl border border-line bg-panel shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search size={16} className="text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tasks, lists, commands…"
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, items.length - 1)))
              if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
              if (e.key === 'Enter') items[active]?.run()
            }}
          />
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-auto p-1.5">
          {items.length === 0 && <div className="p-6 text-center text-muted">No results</div>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? (lastGroup = it.group) : null
            return (
              <div key={it.id}>
                {header && <div className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase text-muted">{header}</div>}
                <button
                  type="button"
                  data-idx={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={it.run}
                  className={cn('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left', i === active && 'bg-hover')}
                >
                  <span className="text-muted">{it.icon}</span>
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="text-xs text-muted">{it.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
