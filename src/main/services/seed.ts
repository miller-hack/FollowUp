import { addDays, localDate } from '@shared/dates'
import { get } from '../db'
import { createFolder, createList, createSpace, getTree } from './hierarchy'
import { createTag } from './meta'
import { addChecklist, addChecklistItem, createTask } from './tasks'

/** Populate an empty database with a small example workspace. */
export function seedIfEmpty(): void {
  if (get('SELECT 1 FROM spaces LIMIT 1')) return
  const today = localDate()

  const personal = createSpace({ name: 'Personal', color: '#7b68ee' })
  const start = createList({ space_id: personal.id, name: 'Getting Started' })
  const statuses = getTree().statuses.filter((s) => s.space_id === personal.id)
  const [todo, doing, , done] = statuses
  const tip = createTag({ name: 'tip' })

  createTask({
    list_id: start.id,
    title: 'Welcome to FollowUp 👋',
    description:
      '<p>Everything lives in <strong>Spaces → Folders → Lists → Tasks</strong>.</p><p>Press <code>Ctrl+N</code> to add a task, <code>Ctrl+K</code> to search.</p>',
    status_id: doing.id,
    priority: 'high',
    due_date: today,
    tag_ids: [tip.id]
  })
  const views = createTask({
    list_id: start.id,
    title: 'Try the Board, Calendar and Gantt views',
    status_id: todo.id,
    priority: 'normal',
    start_date: today,
    due_date: addDays(today, 3),
    tag_ids: [tip.id]
  })
  const cl = addChecklist(views.id, 'Views')
  for (const v of ['List', 'Board', 'Calendar', 'Gantt']) addChecklistItem(cl.id, `Open the ${v} view`)
  createTask({ list_id: start.id, parent_id: views.id, title: 'Drag a card to another column on the Board', status_id: todo.id })
  createTask({
    list_id: start.id,
    title: 'Weekly review',
    status_id: todo.id,
    priority: 'low',
    due_date: addDays(today, 5),
    recurrence: { freq: 'weekly', interval: 1 }
  })
  createTask({ list_id: start.id, title: 'Install FollowUp', status_id: done.id })

  const work = createSpace({ name: 'Work', color: '#0ea5e9' })
  const projects = createFolder({ space_id: work.id, name: 'Projects' })
  const launch = createList({ space_id: work.id, folder_id: projects.id, name: 'Website Launch' })
  const workTodo = getTree().statuses.find((s) => s.space_id === work.id)!
  const plan = [
    ['Define scope & sitemap', 0, 3, 'high'],
    ['Design mockups', 3, 10, 'high'],
    ['Build pages', 8, 20, 'normal'],
    ['Content & SEO', 12, 22, 'normal'],
    ['QA and launch', 21, 25, 'urgent']
  ] as const
  for (const [title, s, e, priority] of plan) {
    createTask({
      list_id: launch.id,
      title,
      status_id: workTodo.id,
      priority,
      start_date: addDays(today, s),
      due_date: addDays(today, e)
    })
  }
  createList({ space_id: work.id, name: 'Inbox' })
}
