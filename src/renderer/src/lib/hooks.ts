import { useMemo } from 'react'
import { QueryClient, useQuery } from '@tanstack/react-query'
import type { Folder, List, Location, Space, Sprint, Status, Task, TaskFilter, TaskPatch, ViewConfig } from '@shared/types'
import { api } from './api'

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } }
})

// Any mutation in the main process invalidates every cached query (local DB = cheap refetch).
window.bridge.onDataChanged(() => void queryClient.invalidateQueries())

export const useTree = () => useQuery({ queryKey: ['tree'], queryFn: () => api.getTree() })
export const useTags = () => useQuery({ queryKey: ['tags'], queryFn: () => api.listTags() })
export const useFields = (spaceId?: string) =>
  useQuery({ queryKey: ['fields', spaceId ?? 'all'], queryFn: () => api.listFields(spaceId) })
export const useTasks = (filter: TaskFilter, enabled = true) =>
  useQuery({ queryKey: ['tasks', filter], queryFn: () => api.queryTasks(filter), enabled, placeholderData: (prev) => prev })
export const useTask = (id: string | null) =>
  useQuery({ queryKey: ['task', id], queryFn: () => api.getTask(id!), enabled: !!id })
export const useMyWork = () => useQuery({ queryKey: ['mywork'], queryFn: () => api.getMyWork() })
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() })
export const useRunningTimer = () => useQuery({ queryKey: ['timer'], queryFn: () => api.getRunningTimer() })
export const useGoals = () => useQuery({ queryKey: ['goals'], queryFn: () => api.listGoals() })
export const useDashboards = () => useQuery({ queryKey: ['dashboards'], queryFn: () => api.listDashboards() })
export const useNotifications = () => useQuery({ queryKey: ['notifications'], queryFn: () => api.listNotifications() })
export const useReminders = () => useQuery({ queryKey: ['reminders'], queryFn: () => api.listReminders() })
export const useAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: () => api.listAccounts() })
export const useFollowUpCounts = () => useQuery({ queryKey: ['followupCounts'], queryFn: () => api.getFollowUpCounts() })
export const useMailFolders = () => useQuery({ queryKey: ['mailFolders'], queryFn: () => api.listMailFolders(null) })
export const useEmailTemplates = () => useQuery({ queryKey: ['emailTemplates'], queryFn: () => api.listEmailTemplates() })
export const useUnreadCount = () => useQuery({ queryKey: ['unread'], queryFn: () => api.getUnreadCount() })
export const useCalendars = () => useQuery({ queryKey: ['calendars'], queryFn: () => api.listCalendars() })
export const useIntegrations = () => useQuery({ queryKey: ['integrations'], queryFn: () => api.listIntegrations() })
export const useOAuthClients = () => useQuery({ queryKey: ['oauthClients'], queryFn: () => api.getOAuthClients() })
export const useUpdateStatus = () => useQuery({ queryKey: ['updateStatus'], queryFn: () => api.getUpdateStatus() })
export const useAiKeyStatus = () => useQuery({ queryKey: ['aiKeys'], queryFn: () => api.getAiKeyStatus() })
export const useAiUsage = () => useQuery({ queryKey: ['aiUsage'], queryFn: () => api.getAiUsage() })
export const useChats = () => useQuery({ queryKey: ['chats'], queryFn: () => api.listChats() })
export const useChat = (id: string | null) => useQuery({ queryKey: ['chat', id], queryFn: () => api.getChat(id!), enabled: !!id })

/** True when the selected AI provider can be used (cloud providers need a key; Ollama needs none). */
export function useAiReady(): boolean {
  const { data: s } = useSettings()
  const { data: keys } = useAiKeyStatus()
  if (!s || !keys) return false
  return s.ai.provider === 'ollama' || keys[s.ai.provider]
}
export const useSprintStats =(id: string | null | undefined) =>
  useQuery({ queryKey: ['sprintStats', id], queryFn: () => api.getSprintStats(id!), enabled: !!id })

export interface TreeMaps {
  spaces: Space[]
  folders: Folder[]
  lists: List[]
  statuses: Status[]
  sprints: Sprint[]
  space: Map<string, Space>
  folder: Map<string, Folder>
  list: Map<string, List>
  status: Map<string, Status>
  sprint: Map<string, Sprint>
  statusesOf: (spaceId: string) => Status[]
  spaceOfLocation: (loc: Location) => string | undefined
}

export function useTreeMaps(): TreeMaps | null {
  const { data } = useTree()
  return useMemo(() => {
    if (!data) return null
    const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]))
    const space = byId(data.spaces)
    const folder = byId(data.folders)
    const list = byId(data.lists)
    const sprint = byId(data.sprints)
    return {
      ...data,
      space,
      folder,
      list,
      sprint,
      status: byId(data.statuses),
      statusesOf: (spaceId: string) => data.statuses.filter((s) => s.space_id === spaceId),
      spaceOfLocation: (loc: Location) =>
        loc.kind === 'space'
          ? loc.id
          : loc.kind === 'folder'
            ? folder.get(loc.id)?.space_id
            : loc.kind === 'sprint'
              ? sprint.get(loc.id)?.space_id
              : list.get(loc.id)?.space_id
    }
  }, [data])
}

export const DEFAULT_VIEW: ViewConfig = {
  view: 'list',
  filter: { includeClosed: false },
  groupBy: 'status',
  sortBy: 'position',
  sortDir: 'asc',
  showSubtasks: true,
  hiddenFields: [],
  ganttZoom: 'day'
}

/** Apply a patch to every cached task list immediately; the real refetch follows. */
export function optimisticPatch(id: string, patch: TaskPatch): void {
  queryClient.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) =>
    old?.map((t) => (t.id === id ? ({ ...t, ...patch, fields: { ...t.fields, ...(patch.fields ?? {}) } } as Task) : t))
  )
}
