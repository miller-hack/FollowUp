import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, closestCorners, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent
} from '@dnd-kit/core'
import { ListTree, Plus } from 'lucide-react'
import { sortTasks } from '@shared/sort'
import type { Status, Task, ViewConfig } from '@shared/types'
import { api } from '@/lib/api'
import { optimisticPatch, useTreeMaps } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'
import { DateField, PriorityIcon, TagList } from '../tasks/pickers'

interface Column {
  key: string
  name: string
  color: string
  tasks: Task[]
}

interface Props {
  tasks: Task[]
  config: ViewConfig
  statuses: Status[]
  defaultListId?: string
  sprintId?: string
}

export function BoardView({ tasks, config, statuses, defaultListId, sprintId }: Props) {
  const maps = useTreeMaps()
  const [dragging, setDragging] = useState<Task | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const columns = useMemo<Column[]>(() => {
    if (!maps) return []
    const cols = new Map<string, Column>()
    for (const s of statuses) {
      const k = s.name.toLowerCase()
      if (!cols.has(k)) cols.set(k, { key: k, name: s.name, color: s.color, tasks: [] })
    }
    for (const t of sortTasks(tasks.filter((t) => !t.parent_id), config.sortBy, config.sortDir)) {
      const s = maps.status.get(t.status_id)
      if (s) cols.get(s.name.toLowerCase())?.tasks.push(t)
    }
    return [...cols.values()]
  }, [maps, statuses, tasks, config.sortBy, config.sortDir])

  if (!maps) return null

  /** Status in the task's own space with the column's name. */
  const statusFor = (task: Task, columnKey: string) => {
    const list = maps.list.get(task.list_id)
    return list ? maps.statusesOf(list.space_id).find((s) => s.name.toLowerCase() === columnKey) : undefined
  }

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null)
    const task = tasks.find((t) => t.id === e.active.id)
    const over = e.over?.id ? String(e.over.id) : null
    if (!task || !over) return
    let columnKey: string
    let beforeId: string | null = null
    if (over.startsWith('col:')) columnKey = over.slice(4)
    else {
      const target = tasks.find((t) => t.id === over.slice(5))
      if (!target || target.id === task.id) return
      columnKey = maps.status.get(target.status_id)!.name.toLowerCase()
      beforeId = config.sortBy === 'position' && target.list_id === task.list_id ? target.id : null
    }
    const status = statusFor(task, columnKey)
    if (!status) return
    if (status.id === task.status_id && !beforeId) return
    optimisticPatch(task.id, { status_id: status.id })
    void api.moveTask(task.id, { status_id: status.id, beforeId })
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e: DragStartEvent) => setDragging(tasks.find((t) => t.id === e.active.id) ?? null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="flex h-full gap-3 overflow-x-auto px-6 py-4">
        {columns.map((c) => (
          <BoardColumn key={c.key} column={c} defaultListId={defaultListId} sprintId={sprintId} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{dragging && <Card task={dragging} overlay />}</DragOverlay>
    </DndContext>
  )
}

function BoardColumn({ column, defaultListId, sprintId }: { column: Column; defaultListId?: string; sprintId?: string }) {
  const maps = useTreeMaps()
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.key}` })
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const add = async () => {
    if (!text.trim() || !defaultListId || !maps) return
    const list = maps.list.get(defaultListId)!
    const status = maps.statusesOf(list.space_id).find((s) => s.name.toLowerCase() === column.key)
    await api.createTask({ list_id: defaultListId, title: text.trim(), status_id: status?.id, sprint_id: sprintId })
    setText('')
  }
  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: `${column.color}1f` }}>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: column.color }} />
        <span className="text-xs font-semibold uppercase tracking-wide">{column.name}</span>
        <span className="text-xs text-muted">{column.tasks.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn('flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto rounded-lg p-1 transition-colors', isOver && 'bg-accent/10')}
      >
        {column.tasks.map((t) => (
          <DraggableCard key={t.id} task={t} />
        ))}
        {defaultListId &&
          (adding ? (
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add()
                if (e.key === 'Escape') setAdding(false)
              }}
              onBlur={() => !text && setAdding(false)}
              placeholder="Task name"
              className="rounded-lg border border-accent bg-panel px-3 py-2 outline-none"
            />
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-hover hover:text-fg">
              <Plus size={13} /> Add task
            </button>
          ))}
      </div>
    </div>
  )
}

function DraggableCard({ task }: { task: Task }) {
  const drag = useDraggable({ id: task.id })
  const drop = useDroppable({ id: `card:${task.id}` })
  return (
    <div
      ref={(n) => {
        drag.setNodeRef(n)
        drop.setNodeRef(n)
      }}
      {...drag.attributes}
      {...drag.listeners}
      className={cn(drag.isDragging && 'opacity-30', drop.isOver && !drag.isDragging && 'border-t-2 border-accent')}
    >
      <Card task={task} />
    </div>
  )
}

function Card({ task, overlay }: { task: Task; overlay?: boolean }) {
  const maps = useTreeMaps()
  const status = maps?.status.get(task.status_id)
  const list = maps?.list.get(task.list_id)
  return (
    <div
      onClick={() => useUi.getState().openTask(task.id)}
      className={cn(
        'cursor-pointer rounded-lg border border-line bg-panel p-3 shadow-sm hover:border-accent/50',
        overlay && 'rotate-2 shadow-xl',
        status?.type === 'done' && 'opacity-70'
      )}
    >
      <div className="mb-1 text-[11px] text-muted">{list?.name}</div>
      <div className={cn('font-medium', status?.type === 'done' && 'line-through')}>{task.title}</div>
      {task.tag_ids.length > 0 && (
        <div className="mt-2">
          <TagList ids={task.tag_ids} />
        </div>
      )}
      <div className="mt-2 flex items-center gap-3 text-xs" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <PriorityIcon priority={task.priority} />
        <DateField value={task.due_date} status={status} onChange={(due_date) => api.updateTask(task.id, { due_date })} placeholder="" />
        <div className="flex-1" />
        {task.subtask_count > 0 && (
          <span className="flex items-center gap-0.5 text-muted">
            <ListTree size={12} /> {task.subtask_done}/{task.subtask_count}
          </span>
        )}
        {task.checklist_total > 0 && (
          <span className="text-muted">
            ☑ {task.checklist_done}/{task.checklist_total}
          </span>
        )}
      </div>
    </div>
  )
}
