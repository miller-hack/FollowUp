import { useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import { AlertTriangle, CalendarClock, CalendarDays, History, Inbox, Loader2, Plus, Sparkles, X } from 'lucide-react'
import type { Task } from '@shared/types'
import { api } from '@/lib/api'
import { useAiReady, useMyWork, useTreeMaps } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'
import { Button, Dot, IconButton } from '@/components/ui'
import { Markdown } from '../ai/Markdown'
import { DateField, PriorityIcon, StatusCircle } from '../tasks/pickers'

function TaskLine({ task }: { task: Task }) {
  const maps = useTreeMaps()
  if (!maps) return null
  const list = maps.list.get(task.list_id)
  const space = list ? maps.space.get(list.space_id) : undefined
  const statuses = list ? maps.statusesOf(list.space_id) : []
  const status = maps.status.get(task.status_id)
  return (
    <div className="group flex h-9 items-center gap-2.5 rounded-md px-2 hover:bg-hover">
      <StatusCircle statuses={statuses} value={task.status_id} onChange={(status_id) => api.updateTask(task.id, { status_id })} />
      <button
        type="button"
        onClick={() => useUi.getState().openTask(task.id)}
        className={cn('min-w-0 flex-1 truncate text-left', status?.type === 'done' && 'text-muted line-through')}
      >
        {task.title}
      </button>
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
        {space && <Dot color={space.color} size={6} />}
        {list?.name}
      </span>
      <PriorityIcon priority={task.priority} />
      <span className="w-24 shrink-0 text-right text-xs">
        <DateField value={task.due_date} status={status} onChange={(due_date) => api.updateTask(task.id, { due_date })} placeholder="" />
      </span>
    </div>
  )
}

function Card({ title, icon, tasks, tone, empty }: { title: string; icon: ReactNode; tasks: Task[]; tone?: string; empty: string }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <h2 className={cn('mb-2 flex items-center gap-2 font-semibold', tone)}>
        {icon} {title} <span className="text-xs font-normal text-muted">{tasks.length}</span>
      </h2>
      {tasks.length === 0 ? <p className="px-2 py-3 text-muted">{empty}</p> : tasks.map((t) => <TaskLine key={t.id} task={t} />)}
    </section>
  )
}

export function Home() {
  const { data } = useMyWork()
  const openQuickAdd = useUi((s) => s.openQuickAdd)
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const aiReady = useAiReady()
  const [review, setReview] = useState<string | 'loading' | null>(null)
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-8 py-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <div className="text-sm text-muted">{format(new Date(), 'EEEE, MMMM d')}</div>
            <h1 className="text-2xl font-semibold">{greeting}</h1>
          </div>
          <div className="flex gap-2">
            {aiReady && (
              <Button
                disabled={review === 'loading'}
                onClick={async () => {
                  setReview('loading')
                  try {
                    setReview(await api.aiWeeklyReview())
                  } catch {
                    setReview(null)
                  }
                }}
              >
                <Sparkles size={14} className="text-accent" /> Review my week
              </Button>
            )}
            <Button variant="primary" onClick={() => openQuickAdd()}>
              <Plus size={15} /> New task
            </Button>
          </div>
        </div>
        {review && (
          <section className="mb-4 rounded-xl border border-accent/40 bg-panel p-4">
            <h2 className="mb-2 flex items-center gap-2 font-semibold">
              <Sparkles size={16} className="text-accent" /> <span className="flex-1">Your week in review</span>
              {review !== 'loading' && (
                <IconButton label="Close review" onClick={() => setReview(null)}>
                  <X size={14} />
                </IconButton>
              )}
            </h2>
            {review === 'loading' ? (
              <div className="flex items-center gap-2 text-muted">
                <Loader2 size={14} className="animate-spin" /> Looking at your week…
              </div>
            ) : (
              <div className="select-text">
                <Markdown text={review} />
              </div>
            )}
          </section>
        )}
        {data && (
          <div className="grid gap-4 lg:grid-cols-2">
            {data.overdue.length > 0 && (
              <div className="lg:col-span-2">
                <Card title="Overdue" icon={<AlertTriangle size={16} />} tone="text-red-500" tasks={data.overdue} empty="" />
              </div>
            )}
            <Card title="Today" icon={<CalendarClock size={16} />} tasks={data.today} empty="Nothing due today 🎉" />
            <Card title="Next 7 days" icon={<CalendarDays size={16} />} tasks={data.upcoming} empty="Nothing scheduled this week." />
            <Card title="Unscheduled" icon={<Inbox size={16} />} tasks={data.unscheduled} empty="Every open task has a due date." />
            <Card title="Recently updated" icon={<History size={16} />} tasks={data.recent} empty="No activity yet." />
          </div>
        )}
      </div>
    </div>
  )
}
