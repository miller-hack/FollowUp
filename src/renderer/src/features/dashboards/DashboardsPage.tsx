import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  BarChart3, CircleDot, Flag, GripVertical, Hash, LayoutDashboard, ListChecks, MoreHorizontal, Pencil, Plus, Tag, Target, Timer, Trash2, TrendingDown, TrendingUp
} from 'lucide-react'
import type { Widget, WidgetConfig, WidgetType } from '@shared/types'
import { api } from '@/lib/api'
import { useDashboards, useTreeMaps } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'
import { Button, Empty, IconButton, InlineEdit, Input, MenuItem, MenuSeparator, Modal, Popover } from '@/components/ui'
import { BarList, Burndown, DailyColumns, ProgressBar, StatValue } from '@/components/charts'
import { DateField, PriorityIcon, StatusCircle } from '../tasks/pickers'
import { LocationSelect } from '@/components/selects'

const CATALOG: { type: WidgetType; label: string; description: string; icon: React.ReactNode; size: number; config: WidgetConfig }[] = [
  { type: 'counter', label: 'Number', description: 'A single headline count', icon: <Hash size={16} />, size: 1, config: { metric: 'open' } },
  { type: 'tasks_by_status', label: 'Tasks by status', description: 'How work is distributed across statuses', icon: <CircleDot size={16} />, size: 2, config: {} },
  { type: 'tasks_by_priority', label: 'Tasks by priority', description: 'Open tasks per priority', icon: <Flag size={16} />, size: 2, config: {} },
  { type: 'completed_trend', label: 'Completed over time', description: 'Tasks completed per day', icon: <TrendingUp size={16} />, size: 2, config: { days: 14 } },
  { type: 'time_by_list', label: 'Time by list', description: 'Tracked time per list', icon: <Timer size={16} />, size: 2, config: { days: 7 } },
  { type: 'time_by_tag', label: 'Time by tag', description: 'Tracked time per tag', icon: <Tag size={16} />, size: 2, config: { days: 7 } },
  { type: 'task_list', label: 'Task list', description: 'Overdue, due soon or recently done', icon: <ListChecks size={16} />, size: 2, config: { list: 'overdue' } },
  { type: 'goals', label: 'Goals', description: 'Progress of every goal', icon: <Target size={16} />, size: 2, config: {} },
  { type: 'sprint_burndown', label: 'Sprint burndown', description: 'Remaining vs ideal for a sprint', icon: <TrendingDown size={16} />, size: 2, config: {} }
]

const METRICS: [NonNullable<WidgetConfig['metric']>, string][] = [
  ['open', 'Open tasks'],
  ['overdue', 'Overdue tasks'],
  ['due_today', 'Due today'],
  ['done_week', 'Completed (7 days)'],
  ['time_week', 'Time tracked (7 days)']
]

export function DashboardsPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: dashboards } = useDashboards()
  if (!dashboards) return null
  if (!id || !dashboards.some((d) => d.id === id)) return dashboards[0] ? <Navigate to={`/dashboards/${dashboards[0].id}`} replace /> : null

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-1 border-b border-line bg-panel px-6 pt-4">
        <LayoutDashboard size={18} className="mr-1 mb-2 text-muted" />
        {dashboards.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => navigate(`/dashboards/${d.id}`)}
            className={cn('-mb-px border-b-2 px-3 pb-2 text-[13px]', d.id === id ? 'border-accent font-medium' : 'border-transparent text-muted hover:text-fg')}
          >
            {d.name}
          </button>
        ))}
        <IconButton
          label="New dashboard"
          className="mb-1.5"
          onClick={async () => {
            const d = await api.createDashboard('New dashboard')
            navigate(`/dashboards/${d.id}`)
          }}
        >
          <Plus size={15} />
        </IconButton>
      </header>
      <DashboardBody key={id} id={id} />
    </div>
  )
}

function DashboardBody({ id }: { id: string }) {
  const navigate = useNavigate()
  const { data: dashboard } = useQuery({ queryKey: ['dashboard', id], queryFn: () => api.getDashboard(id) })
  const [order, setOrder] = useState<Widget[]>([])
  const [editing, setEditing] = useState<Widget | 'new' | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  useEffect(() => setOrder(dashboard?.widgets ?? []), [dashboard])
  if (!dashboard) return null

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const next = arrayMove(order, order.findIndex((w) => w.id === e.active.id), order.findIndex((w) => w.id === e.over!.id))
    setOrder(next)
    void api.reorderWidgets(next.map((w) => w.id))
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-6 py-5">
        <div className="mb-4 flex items-center gap-2">
          <InlineEdit value={dashboard.name} onSave={(name) => api.updateDashboard(id, { name })} className="text-lg font-semibold" />
          <div className="flex-1" />
          <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
            <Plus size={14} /> Add widget
          </Button>
          <Popover align="end" trigger={<IconButton label="Dashboard options"><MoreHorizontal size={15} /></IconButton>}>
            {(close) => (
              <MenuItem
                danger
                icon={<Trash2 size={14} />}
                onClick={async () => {
                  close()
                  if (window.confirm(`Delete dashboard “${dashboard.name}”?`)) {
                    await api.deleteDashboard(id)
                    navigate('/dashboards')
                  }
                }}
              >
                Delete dashboard
              </MenuItem>
            )}
          </Popover>
        </div>
        {order.length === 0 && <Empty>This dashboard is empty. Add a widget to get started.</Empty>}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order.map((w) => w.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-4 gap-4">
              {order.map((w) => (
                <WidgetCard key={w.id} widget={w} onEdit={() => setEditing(w)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
      {editing && <WidgetEditor dashboardId={id} widget={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function WidgetCard({ widget, onEdit }: { widget: Widget; onEdit: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id })
  const { data } = useQuery({ queryKey: ['widget', widget.id, widget.config, widget.type], queryFn: () => api.getWidgetData(widget.id) })
  const span = ['', 'col-span-1', 'col-span-2', 'col-span-3', 'col-span-4'][widget.size] ?? 'col-span-2'
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('group flex min-h-36 flex-col rounded-xl border border-line bg-panel p-4', span, isDragging && 'z-10 opacity-80 shadow-xl')}
    >
      <div className="mb-3 flex items-center gap-1">
        <button type="button" aria-label="Drag to reorder" className="-ml-1 cursor-grab text-muted opacity-0 group-hover:opacity-100 active:cursor-grabbing" {...attributes} {...listeners}>
          <GripVertical size={14} />
        </button>
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{widget.title}</h3>
        <Popover align="end" trigger={<IconButton label="Widget options" className="h-6 w-6 opacity-0 group-hover:opacity-100"><MoreHorizontal size={14} /></IconButton>}>
          {(close) => (
            <>
              <MenuItem icon={<Pencil size={14} />} onClick={() => (close(), onEdit())}>Edit</MenuItem>
              <MenuSeparator />
              <div className="px-2 py-1 text-[11px] font-semibold uppercase text-muted">Width</div>
              {[1, 2, 3, 4].map((s) => (
                <MenuItem key={s} active={widget.size === s} onClick={() => (api.updateWidget(widget.id, { size: s }), close())}>
                  {s === 4 ? 'Full width' : `${s} / 4`}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem danger icon={<Trash2 size={14} />} onClick={() => (close(), api.deleteWidget(widget.id))}>Remove</MenuItem>
            </>
          )}
        </Popover>
      </div>
      <div className="min-h-0 flex-1">{data ? <WidgetBody widget={widget} data={data} /> : null}</div>
    </section>
  )
}

function WidgetBody({ widget, data }: { widget: Widget; data: Awaited<ReturnType<typeof api.getWidgetData>> }) {
  const maps = useTreeMaps()
  switch (data.kind) {
    case 'counter':
      return <StatValue value={data.value} unit={data.unit} caption={data.caption} />
    case 'breakdown':
      return <BarList items={data.items} unit={data.unit} empty={data.unit === 'minutes' ? 'No time tracked in this period' : 'No tasks'} />
    case 'series':
      return <DailyColumns points={data.points} />
    case 'goals':
      return data.goals.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted">No goals yet</div>
      ) : (
        <ul className="space-y-3">
          {data.goals.map((g) => (
            <li key={g.id}>
              <div className="mb-1 flex text-xs">
                <span className="flex-1 truncate">{g.name}</span>
                <span className="font-semibold tabular-nums">{Math.round(g.progress * 100)}%</span>
              </div>
              <ProgressBar value={g.progress} color={g.color} />
            </li>
          ))}
        </ul>
      )
    case 'tasks':
      return data.tasks.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted">Nothing here 🎉</div>
      ) : (
        <ul className="-mx-2 max-h-72 overflow-auto">
          {data.tasks.map((t) => {
            const list = maps?.list.get(t.list_id)
            return (
              <li key={t.id} className="flex h-8 items-center gap-2 rounded px-2 hover:bg-hover">
                <StatusCircle statuses={list ? maps!.statusesOf(list.space_id) : []} value={t.status_id} onChange={(status_id) => api.updateTask(t.id, { status_id })} />
                <button type="button" className="min-w-0 flex-1 truncate text-left text-[13px]" onClick={() => useUi.getState().openTask(t.id)}>
                  {t.title}
                </button>
                <PriorityIcon priority={t.priority} />
                <span className="w-20 text-right text-xs">
                  <DateField value={t.due_date} status={maps?.status.get(t.status_id)} onChange={(due_date) => api.updateTask(t.id, { due_date })} placeholder="" />
                </span>
              </li>
            )
          })}
        </ul>
      )
    case 'burndown':
      return data.stats ? (
        <>
          <div className="mb-1 text-xs text-muted">{data.stats.sprint.name}</div>
          <Burndown stats={data.stats} height={widget.size >= 3 ? 240 : 190} />
        </>
      ) : (
        <div className="py-6 text-center text-xs text-muted">No sprint to show. Create one from a space’s menu.</div>
      )
  }
}

function WidgetEditor({ dashboardId, widget, onClose }: { dashboardId: string; widget: Widget | null; onClose: () => void }) {
  const maps = useTreeMaps()
  const [type, setType] = useState<WidgetType | null>(widget?.type ?? null)
  const entry = CATALOG.find((c) => c.type === type)
  const [title, setTitle] = useState(widget?.title ?? '')
  const [config, setConfig] = useState<WidgetConfig>(widget?.config ?? {})
  const pick = (t: WidgetType) => {
    const c = CATALOG.find((x) => x.type === t)!
    setType(t)
    setTitle(c.label)
    setConfig(c.config)
  }
  const save = async () => {
    if (!type || !entry) return
    if (widget) await api.updateWidget(widget.id, { title: title || entry.label, config })
    else await api.addWidget(dashboardId, { type, title: title || entry.label, config, size: entry.size })
    onClose()
  }
  const set = (p: Partial<WidgetConfig>) => setConfig({ ...config, ...p })

  return (
    <Modal
      title={widget ? 'Edit widget' : 'Add widget'}
      onClose={onClose}
      width={620}
      footer={
        type && (
          <>
            {!widget && <Button variant="ghost" onClick={() => setType(null)}>Back</Button>}
            <Button variant="primary" onClick={save}>{widget ? 'Save' : 'Add widget'}</Button>
          </>
        )
      }
    >
      {!type ? (
        <div className="grid grid-cols-3 gap-2">
          {CATALOG.map((c) => (
            <button key={c.type} type="button" onClick={() => pick(c.type)} className="rounded-lg border border-line p-3 text-left hover:border-accent hover:bg-hover">
              <div className="mb-1.5 text-accent">{c.icon}</div>
              <div className="text-[13px] font-medium">{c.label}</div>
              <div className="text-xs text-muted">{c.description}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3 text-[13px]">
          <label className="block">
            <span className="text-xs text-muted">Title</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
          </label>
          {type !== 'goals' && type !== 'sprint_burndown' && (
            <label className="block">
              <span className="text-xs text-muted">Scope</span>
              <div className="mt-1">
                <LocationSelect value={config.location} onChange={(location) => set({ location })} />
              </div>
            </label>
          )}
          {type === 'counter' && (
            <label className="block">
              <span className="text-xs text-muted">Show</span>
              <select value={config.metric ?? 'open'} onChange={(e) => set({ metric: e.target.value as WidgetConfig['metric'] })} className="mt-1 h-8 w-full rounded-md border border-line bg-panel px-2">
                {METRICS.map(([m, l]) => (
                  <option key={m} value={m}>{l}</option>
                ))}
              </select>
            </label>
          )}
          {type === 'task_list' && (
            <label className="block">
              <span className="text-xs text-muted">Tasks</span>
              <select value={config.list ?? 'overdue'} onChange={(e) => set({ list: e.target.value as WidgetConfig['list'] })} className="mt-1 h-8 w-full rounded-md border border-line bg-panel px-2">
                <option value="overdue">Overdue</option>
                <option value="due_soon">Due in the next 7 days</option>
                <option value="recently_done">Recently completed</option>
              </select>
            </label>
          )}
          {(type === 'completed_trend' || type === 'time_by_list' || type === 'time_by_tag') && (
            <label className="block">
              <span className="text-xs text-muted">Period</span>
              <select value={config.days ?? 7} onChange={(e) => set({ days: Number(e.target.value) })} className="mt-1 h-8 w-full rounded-md border border-line bg-panel px-2">
                {[7, 14, 30, 90].map((d) => (
                  <option key={d} value={d}>Last {d} days</option>
                ))}
              </select>
            </label>
          )}
          {type === 'sprint_burndown' && (
            <label className="block">
              <span className="text-xs text-muted">Sprint</span>
              <select value={config.sprint_id ?? ''} onChange={(e) => set({ sprint_id: e.target.value || null })} className="mt-1 h-8 w-full rounded-md border border-line bg-panel px-2">
                <option value="">Current active sprint</option>
                {maps?.sprints.map((s) => (
                  <option key={s.id} value={s.id}>{maps.space.get(s.space_id)?.name} · {s.name}</option>
                ))}
              </select>
            </label>
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <BarChart3 size={13} /> {entry?.description}
          </p>
        </div>
      )}
    </Modal>
  )
}
