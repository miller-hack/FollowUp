import type { Priority, SortBy, Task } from './types'

export const PRIORITY_ORDER: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3, none: 4 }

export function sortTasks(tasks: Task[], by: SortBy, dir: 'asc' | 'desc'): Task[] {
  const k = dir === 'asc' ? 1 : -1
  return [...tasks].sort((a, b) => {
    switch (by) {
      case 'title':
        return k * a.title.localeCompare(b.title)
      case 'priority':
        return k * (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
      case 'due_date':
        return k * (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')
      case 'created_at':
        return k * a.created_at.localeCompare(b.created_at)
      default:
        return k * (a.position - b.position)
    }
  })
}
