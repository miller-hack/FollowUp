import { useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronDown, ChevronRight, CircleDot, Folder as FolderIcon, FolderPlus, Home, Layers, List as ListIcon, ListPlus, MoreHorizontal,
  Palette, Pencil, Plus, Search, Settings, SlidersHorizontal, Trash2, FolderInput, LayoutDashboard, Target, Timer, Zap, Inbox, Send, CalendarDays, Sparkles, ArrowUpCircle, Building2
} from 'lucide-react'
import type { Folder, List, Space, Sprint } from '@shared/types'
import { NotificationCenter } from '../notifications/NotificationCenter'
import { RunningTimerBar } from '../time/timer'
import { api } from '@/lib/api'
import { useFollowUpCounts, useTreeMaps, useUnreadCount, useUpdateStatus } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'
import { ColorGrid, Dot, IconButton, InlineEdit, MenuItem, MenuSeparator, Popover } from '@/components/ui'
import { FieldManager, StatusEditor } from './SpaceSettings'

const EXPANDED_KEY = 'sidebar:collapsed'

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function TreeRow({
  depth,
  to,
  icon,
  label,
  expanded,
  onToggle,
  menu,
  active
}: {
  depth: number
  to?: string
  icon: ReactNode
  label: ReactNode
  expanded?: boolean
  onToggle?: () => void
  menu?: ReactNode
  active?: boolean
}) {
  const navigate = useNavigate()
  return (
    <div
      className={cn('group flex h-7 cursor-pointer items-center gap-1 rounded-md pr-1 text-[13px] hover:bg-hover', active && 'bg-hover font-medium')}
      style={{ paddingLeft: 4 + depth * 14 }}
      onClick={() => (to ? navigate(to) : onToggle?.())}
    >
      <button
        type="button"
        aria-label={expanded ? 'Collapse' : 'Expand'}
        className={cn('flex h-5 w-4 items-center justify-center text-muted', !onToggle && 'invisible')}
        onClick={(e) => (e.stopPropagation(), onToggle?.())}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      <span className="flex w-4 justify-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {menu && <span className="invisible group-hover:visible has-[[aria-expanded=true]]:visible">{menu}</span>}
    </div>
  )
}

const MoreButton = () => (
  <IconButton label="More" className="h-5 w-5">
    <MoreHorizontal size={14} />
  </IconButton>
)

export function Sidebar() {
  const maps = useTreeMaps()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const setPalette = useUi((s) => s.setPalette)
  const openQuickAdd = useUi((s) => s.openQuickAdd)
  const assistantOpen = useUi((s) => s.assistantOpen)
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [statusSpace, setStatusSpace] = useState<Space | null>(null)
  const [fieldSpace, setFieldSpace] = useState<Space | null>(null)
  const { data: unread = 0 } = useUnreadCount()
  const { data: fu } = useFollowUpCounts()
  const followUps = (fu?.reply ?? 0) + (fu?.nudge ?? 0)
  const { search } = useLocation()
  const { data: update } = useUpdateStatus()

  const toggle = (id: string) => {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setCollapsed(next)
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]))
    } catch {
      /* storage unavailable */
    }
  }
  const expand = (id: string) => {
    if (collapsed.has(id)) toggle(id)
  }

  const newList = async (spaceId: string, folderId: string | null = null) => {
    const l = await api.createList({ space_id: spaceId, folder_id: folderId, name: 'New List' })
    expand(spaceId)
    if (folderId) expand(folderId)
    setRenaming(l.id)
    navigate(`/l/list/${l.id}`)
  }

  const label = (id: string, name: string, save: (n: string) => void) =>
    renaming === id ? (
      <span onClick={(e) => e.stopPropagation()}>
        <InlineEdit value={name} autoEdit onSave={(n) => (save(n), setRenaming(null))} onCancel={() => setRenaming(null)} />
      </span>
    ) : (
      name
    )

  const isActive = (kind: string, id: string) => pathname === `/l/${kind}/${id}`

  const listRow = (l: List, depth: number) => (
    <TreeRow
      key={l.id}
      depth={depth}
      to={`/l/list/${l.id}`}
      active={isActive('list', l.id)}
      icon={l.color ? <Dot color={l.color} /> : <ListIcon size={13} />}
      label={label(l.id, l.name, (name) => api.updateList(l.id, { name }))}
      menu={
        <Popover trigger={<MoreButton />}>
          {(close) => (
            <>
              <MenuItem icon={<Pencil size={14} />} onClick={() => (setRenaming(l.id), close())}>Rename</MenuItem>
              <Popover trigger={<MenuItem icon={<Palette size={14} />}>Color</MenuItem>} triggerClassName="w-full">
                <ColorGrid value={l.color} onChange={(color) => (api.updateList(l.id, { color }), close())} />
              </Popover>
              <Popover trigger={<MenuItem icon={<FolderInput size={14} />}>Move to…</MenuItem>} triggerClassName="w-full">
                <div className="max-h-72 w-56 overflow-auto">
                  {maps!.spaces.map((s) => (
                    <div key={s.id}>
                      <MenuItem icon={<Dot color={s.color} />} active={l.space_id === s.id && !l.folder_id} onClick={() => (api.updateList(l.id, { space_id: s.id, folder_id: null }), close())}>
                        {s.name}
                      </MenuItem>
                      {maps!.folders.filter((f) => f.space_id === s.id).map((f) => (
                        <MenuItem key={f.id} icon={<FolderIcon size={13} />} active={l.folder_id === f.id} onClick={() => (api.updateList(l.id, { space_id: s.id, folder_id: f.id }), close())}>
                          <span className="pl-3">{f.name}</span>
                        </MenuItem>
                      ))}
                    </div>
                  ))}
                </div>
              </Popover>
              <MenuSeparator />
              <MenuItem
                danger
                icon={<Trash2 size={14} />}
                onClick={async () => {
                  close()
                  if (window.confirm(`Delete list “${l.name}” and all its tasks?`)) {
                    await api.deleteList(l.id)
                    if (isActive('list', l.id)) navigate('/')
                  }
                }}
              >
                Delete
              </MenuItem>
            </>
          )}
        </Popover>
      }
    />
  )

  const sprintRow = (sp: Sprint) => (
    <TreeRow
      key={sp.id}
      depth={1}
      to={`/l/sprint/${sp.id}`}
      active={isActive('sprint', sp.id)}
      icon={<Zap size={13} className={sp.status === 'active' ? 'text-amber-500' : undefined} />}
      label={label(sp.id, sp.name, (name) => api.updateSprint(sp.id, { name }))}
      menu={
        <Popover trigger={<MoreButton />}>
          {(close) => (
            <>
              <MenuItem icon={<Pencil size={14} />} onClick={() => (setRenaming(sp.id), close())}>Rename</MenuItem>
              <MenuSeparator />
              <MenuItem
                danger
                icon={<Trash2 size={14} />}
                onClick={async () => {
                  close()
                  if (window.confirm(`Delete sprint “${sp.name}”? Its tasks are kept.`)) {
                    await api.deleteSprint(sp.id)
                    if (isActive('sprint', sp.id)) navigate('/')
                  }
                }}
              >
                Delete sprint
              </MenuItem>
            </>
          )}
        </Popover>
      }
    />
  )

  const folderRow = (f: Folder) => {
    const open = !collapsed.has(f.id)
    return (
      <div key={f.id}>
        <TreeRow
          depth={1}
          to={`/l/folder/${f.id}`}
          active={isActive('folder', f.id)}
          icon={<FolderIcon size={13} />}
          label={label(f.id, f.name, (name) => api.updateFolder(f.id, { name }))}
          expanded={open}
          onToggle={() => toggle(f.id)}
          menu={
            <Popover trigger={<MoreButton />}>
              {(close) => (
                <>
                  <MenuItem icon={<ListPlus size={14} />} onClick={() => (close(), newList(f.space_id, f.id))}>New list</MenuItem>
                  <MenuItem icon={<Pencil size={14} />} onClick={() => (setRenaming(f.id), close())}>Rename</MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    danger
                    icon={<Trash2 size={14} />}
                    onClick={async () => {
                      close()
                      if (window.confirm(`Delete folder “${f.name}” with all its lists and tasks?`)) {
                        await api.deleteFolder(f.id)
                        navigate('/')
                      }
                    }}
                  >
                    Delete
                  </MenuItem>
                </>
              )}
            </Popover>
          }
        />
        {open && maps!.lists.filter((l) => l.folder_id === f.id).map((l) => listRow(l, 2))}
      </div>
    )
  }

  return (
    <nav className="flex h-full w-full flex-col border-r border-line bg-sidebar">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-fg">F</div>
        <span className="text-[15px] font-semibold">FollowUp</span>
      </div>
      <div className="flex gap-1.5 px-3 pb-3">
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="flex h-8 flex-1 items-center gap-2 rounded-md border border-line bg-panel px-2.5 text-muted hover:text-fg"
        >
          <Search size={14} /> <span className="flex-1 text-left">Search</span> <kbd className="text-[10px]">Ctrl K</kbd>
        </button>
        <NotificationCenter />
        <IconButton label="New task (Ctrl+N)" className="h-8 w-8 border border-line bg-panel" onClick={() => openQuickAdd()}>
          <Plus size={16} />
        </IconButton>
      </div>

      <RunningTimerBar />

      <div className="px-2">
        {[
          { to: '/', icon: <Home size={15} />, label: 'Home', end: true },
          { to: '/inbox', icon: <Inbox size={15} />, label: 'Inbox', end: true, badge: unread, active: pathname === '/inbox' && !search.includes('folder=followups') },
          { to: '/inbox?folder=followups', icon: <Send size={15} />, label: 'Follow-up', end: true, badge: followUps, active: pathname === '/inbox' && search.includes('folder=followups') },
          { to: '/clients', icon: <Building2 size={15} />, label: 'Clients', end: true },
          { to: '/calendar', icon: <CalendarDays size={15} />, label: 'Calendar', end: true },
          { to: '/everything', icon: <Layers size={15} />, label: 'Everything', end: true },
          { to: '/dashboards', icon: <LayoutDashboard size={15} />, label: 'Dashboards', end: false },
          { to: '/goals', icon: <Target size={15} />, label: 'Goals', end: true },
          { to: '/time', icon: <Timer size={15} />, label: 'Time tracking', end: true },
          { to: '/automations', icon: <Zap size={15} />, label: 'Automations', end: true }
        ].map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => cn('flex h-8 items-center gap-2.5 rounded-md px-2.5 hover:bg-hover', ('active' in n ? n.active : isActive) && 'bg-hover font-medium')}
          >
            <span className="text-muted">{n.icon}</span>
            <span className="flex-1">{n.label}</span>
            {'badge' in n && n.badge ? <span className="text-xs font-semibold text-accent">{n.badge}</span> : null}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => (useUi.getState().assistantOpen ? useUi.getState().closeAssistant() : useUi.getState().openAssistant())}
          className={cn('flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 hover:bg-hover', assistantOpen && 'bg-hover font-medium')}
        >
          <Sparkles size={15} className="text-accent" />
          <span className="flex-1 text-left">AI assistant</span>
          <kbd className="text-[10px] text-muted">Ctrl J</kbd>
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between px-4 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Spaces</span>
        <IconButton
          label="New space"
          className="h-5 w-5"
          onClick={async () => {
            const s = await api.createSpace({ name: 'New Space' })
            setRenaming(s.id)
          }}
        >
          <Plus size={14} />
        </IconButton>
      </div>

      <div className="flex-1 overflow-auto px-2 pb-4">
        {maps?.spaces.map((s) => {
          const open = !collapsed.has(s.id)
          return (
            <div key={s.id} className="mb-0.5">
              <TreeRow
                depth={0}
                to={`/l/space/${s.id}`}
                active={isActive('space', s.id)}
                icon={<span className="flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold text-white" style={{ background: s.color }}>{s.name[0]?.toUpperCase()}</span>}
                label={label(s.id, s.name, (name) => api.updateSpace(s.id, { name }))}
                expanded={open}
                onToggle={() => toggle(s.id)}
                menu={
                  <Popover trigger={<MoreButton />}>
                    {(close) => (
                      <>
                        <MenuItem icon={<ListPlus size={14} />} onClick={() => (close(), newList(s.id))}>New list</MenuItem>
                        <MenuItem
                          icon={<Zap size={14} />}
                          onClick={async () => {
                            close()
                            const sp = await api.createSprint({ space_id: s.id })
                            expand(s.id)
                            navigate(`/l/sprint/${sp.id}`)
                          }}
                        >
                          New sprint
                        </MenuItem>
                        <MenuItem
                          icon={<FolderPlus size={14} />}
                          onClick={async () => {
                            close()
                            const f = await api.createFolder({ space_id: s.id, name: 'New Folder' })
                            expand(s.id)
                            setRenaming(f.id)
                          }}
                        >
                          New folder
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem icon={<Pencil size={14} />} onClick={() => (setRenaming(s.id), close())}>Rename</MenuItem>
                        <Popover trigger={<MenuItem icon={<Palette size={14} />}>Color</MenuItem>} triggerClassName="w-full">
                          <ColorGrid value={s.color} onChange={(color) => (api.updateSpace(s.id, { color }), close())} />
                        </Popover>
                        <MenuItem icon={<CircleDot size={14} />} onClick={() => (setStatusSpace(s), close())}>Statuses</MenuItem>
                        <MenuItem icon={<SlidersHorizontal size={14} />} onClick={() => (setFieldSpace(s), close())}>Custom fields</MenuItem>
                        <MenuSeparator />
                        <MenuItem
                          danger
                          icon={<Trash2 size={14} />}
                          onClick={async () => {
                            close()
                            if (window.confirm(`Delete space “${s.name}” with everything in it? This cannot be undone.`)) {
                              await api.deleteSpace(s.id)
                              navigate('/')
                            }
                          }}
                        >
                          Delete space
                        </MenuItem>
                      </>
                    )}
                  </Popover>
                }
              />
              {open && (
                <>
                  {maps.folders.filter((f) => f.space_id === s.id).map(folderRow)}
                  {maps.lists.filter((l) => l.space_id === s.id && !l.folder_id).map((l) => listRow(l, 1))}
                  {maps.sprints.filter((sp) => sp.space_id === s.id && sp.status !== 'closed').map((sp) => sprintRow(sp))}
                  {maps.lists.every((l) => l.space_id !== s.id) && (
                    <button type="button" onClick={() => newList(s.id)} className="ml-9 flex h-7 items-center gap-1.5 text-xs text-muted hover:text-fg">
                      <Plus size={12} /> New list
                    </button>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className="border-t border-line p-2">
        {update?.state === 'ready' && (
          <button
            type="button"
            onClick={() => api.installUpdate()}
            className="mb-1 flex h-8 w-full items-center gap-2.5 rounded-md bg-accent/10 px-2.5 text-left text-accent hover:bg-accent/15"
          >
            <ArrowUpCircle size={15} />
            <span className="flex-1 truncate">Restart to update ({update.next})</span>
          </button>
        )}
        <NavLink
          to="/settings"
          className={({ isActive }) => cn('flex h-8 items-center gap-2.5 rounded-md px-2.5 hover:bg-hover', isActive && 'bg-hover font-medium')}
        >
          <Settings size={15} className="text-muted" /> Settings
        </NavLink>
      </div>

      {statusSpace && <StatusEditor space={statusSpace} onClose={() => setStatusSpace(null)} />}
      {fieldSpace && <FieldManager space={fieldSpace} onClose={() => setFieldSpace(null)} />}
    </nav>
  )
}
