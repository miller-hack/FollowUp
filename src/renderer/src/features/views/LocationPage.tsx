import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CalendarDays, ChartGantt, Columns3, List as ListIcon, Plus } from 'lucide-react'
import type { Location, TaskFilter, ViewConfig, ViewType } from '@shared/types'
import { api } from '@/lib/api'
import { DEFAULT_VIEW, useFields, useTasks, useTreeMaps } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'
import { Button, Dot, Empty } from '@/components/ui'
import { FilterBar } from './FilterBar'
import { ListView } from './ListView'
import { BoardView } from './BoardView'
import { CalendarView } from './CalendarView'
import { GanttView } from './GanttView'
import { SprintHeader } from './SprintHeader'

const VIEWS: { type: ViewType; label: string; icon: React.ReactNode }[] = [
  { type: 'list', label: 'List', icon: <ListIcon size={14} /> },
  { type: 'board', label: 'Board', icon: <Columns3 size={14} /> },
  { type: 'calendar', label: 'Calendar', icon: <CalendarDays size={14} /> },
  { type: 'gantt', label: 'Gantt', icon: <ChartGantt size={14} /> }
]

/** Load & persist the view config for a location key. */
function useViewConfig(key: string): [ViewConfig, (patch: Partial<ViewConfig>) => void] {
  const [config, setConfig] = useState<ViewConfig>(DEFAULT_VIEW)
  useEffect(() => {
    let alive = true
    setConfig(DEFAULT_VIEW)
    void api.getViewConfig(key).then((c) => alive && c && setConfig({ ...DEFAULT_VIEW, ...c, filter: { ...DEFAULT_VIEW.filter, ...c.filter } }))
    return () => {
      alive = false
    }
  }, [key])
  const update = (patch: Partial<ViewConfig>) => {
    setConfig((c) => {
      const next = { ...c, ...patch }
      void api.setViewConfig(key, next)
      return next
    })
  }
  return [config, update]
}

export function LocationPage({ everything }: { everything?: boolean }) {
  const params = useParams<{ kind: Location['kind']; id: string }>()
  const location: Location | undefined = everything ? undefined : { kind: params.kind!, id: params.id! }
  const key = location ? `${location.kind}:${location.id}` : 'everything'
  const maps = useTreeMaps()
  const openQuickAdd = useUi((s) => s.openQuickAdd)
  const [config, setConfig] = useViewConfig(key)

  const spaceId = location && maps ? maps.spaceOfLocation(location) : undefined
  const defaultListId = !maps
    ? undefined
    : location?.kind === 'list'
      ? location.id
      : maps.lists.find((l) => (location?.kind === 'folder' ? l.folder_id === location.id : spaceId ? l.space_id === spaceId : true))?.id

  const sprintId = location?.kind === 'sprint' ? location.id : undefined

  useEffect(() => {
    useUi.setState({ contextListId: location ? (defaultListId ?? null) : null, contextSprintId: sprintId ?? null })
    return () => useUi.setState({ contextListId: null, contextSprintId: null })
  }, [defaultListId, location?.kind, sprintId])
  const { data: fields = [] } = useFields(spaceId)
  const statuses = useMemo(() => (maps ? (spaceId ? maps.statusesOf(spaceId) : maps.statuses) : []), [maps, spaceId])

  const filter: TaskFilter = {
    ...config.filter,
    location,
    // board shows every column, including Done
    includeClosed: config.view === 'board' ? true : config.filter.includeClosed
  }
  const { data: tasks = [], isLoading } = useTasks(filter, !!maps)

  if (!maps) return null
  const title = !location
    ? 'Everything'
    : location.kind === 'space'
      ? maps.space.get(location.id)?.name
      : location.kind === 'folder'
        ? maps.folder.get(location.id)?.name
        : location.kind === 'sprint'
          ? maps.sprint.get(location.id)?.name
          : maps.list.get(location.id)?.name
  if (location && title === undefined) return <Empty>This location no longer exists.</Empty>
  const space = spaceId ? maps.space.get(spaceId) : undefined

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="border-b border-line bg-panel px-6 pt-4">
        <div className="flex items-center gap-2">
          {space && <Dot color={space.color} size={10} />}
          {space && location?.kind !== 'space' && <span className="text-muted">{space.name} /</span>}
          <h1 className="text-lg font-semibold">{title}</h1>
          <div className="flex-1" />
          <Button variant="primary" size="sm" disabled={!defaultListId} onClick={() => openQuickAdd({ list_id: defaultListId, sprint_id: sprintId })}>
            <Plus size={14} /> Task
          </Button>
        </div>
        {sprintId && <SprintHeader sprintId={sprintId} />}
        <div className="mt-3 flex gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.type}
              type="button"
              onClick={() => setConfig({ view: v.type })}
              className={cn(
                '-mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2 text-[13px]',
                config.view === v.type ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'
              )}
            >
              {v.icon}
              {v.label}
            </button>
          ))}
        </div>
      </header>
      <FilterBar config={config} onChange={setConfig} statuses={statuses} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading ? null : config.view === 'list' ? (
          <ListView tasks={tasks} config={config} onConfig={setConfig} statuses={statuses} fields={fields} location={location} defaultListId={defaultListId} sprintId={sprintId} />
        ) : config.view === 'board' ? (
          <BoardView tasks={tasks} config={config} statuses={statuses} defaultListId={defaultListId} sprintId={sprintId} />
        ) : config.view === 'calendar' ? (
          <CalendarView tasks={tasks} defaultListId={defaultListId} sprintId={sprintId} />
        ) : (
          <GanttView tasks={tasks} config={config} onConfig={setConfig} />
        )}
      </div>
    </div>
  )
}
