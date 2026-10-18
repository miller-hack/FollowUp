import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Task, Tree } from '@shared/types'
import { DEFAULT_VIEW } from '@/lib/hooks'
import { ListView } from '@/features/views/ListView'
import { RichEditor } from '@/features/tasks/RichEditor'
import { EmailBody } from '@/features/mail/EmailBody'
import { handlers } from './setup'

const withQueries = (ui: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

// ---------------------------------------------------------------- ListView virtualisation (ADR-011)

const tree: Tree = {
  spaces: [{ id: 's1', name: 'Work', color: '#7b68ee', position: 0 } as Tree['spaces'][number]],
  folders: [],
  lists: [{ id: 'l1', space_id: 's1', folder_id: null, name: 'Inbox', position: 0 } as Tree['lists'][number]],
  statuses: [
    { id: 'open', space_id: 's1', name: 'To do', color: '#87909e', type: 'open', position: 0 },
    { id: 'done', space_id: 's1', name: 'Done', color: '#22c55e', type: 'done', position: 1 }
  ],
  sprints: []
}

const task = (i: number, extra: Partial<Task> = {}): Task => ({
  id: `t${i}`, list_id: 'l1', parent_id: null, title: `Task number ${i}`, description: '', status_id: 'open', priority: 'none',
  start_date: null, due_date: null, time_estimate_min: null, position: i, completed_at: null, recurrence: null, sprint_id: null,
  created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', time_spent_min: 0, tag_ids: [], fields: {},
  subtask_count: 0, subtask_done: 0, checklist_total: 0, checklist_done: 0, blocked_by: [], ...extra
})

describe('ListView', () => {
  const renderList = (tasks: Task[]) => {
    handlers.getTree = () => tree
    handlers.getRunningTimer = () => null
    handlers.listTags = () => []
    // jsdom has no layout: give the scroller a viewport and every measured row a height
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.index !== undefined ? 36 : 600
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200)
    return withQueries(
      <div style={{ height: 600 }}>
        <ListView tasks={tasks} config={DEFAULT_VIEW} onConfig={() => {}} statuses={tree.statuses} fields={[]} location={{ kind: 'list', id: 'l1' }} defaultListId="l1" />
      </div>
    )
  }

  it('renders only the rows in view for a 5,000-task list', async () => {
    const tasks = Array.from({ length: 5000 }, (_, i) => task(i))
    renderList(tasks)
    await screen.findByText('Task number 0')
    const shown = screen.getAllByText(/^Task number \d+$/)
    expect(shown.length).toBeGreaterThan(5)
    expect(shown.length).toBeLessThan(100)
    expect(screen.queryByText('Task number 4999')).toBeNull()
    // group header with the full count
    expect(screen.getByText('5000')).toBeTruthy()
  })

  it('shows later rows after scrolling', async () => {
    const { container } = renderList(Array.from({ length: 5000 }, (_, i) => task(i)))
    await screen.findByText('Task number 0')
    const scroller = container.querySelector('.overflow-auto') as HTMLDivElement
    await act(async () => {
      scroller.scrollTop = 36 * 3000
      fireEvent.scroll(scroller)
    })
    await waitFor(() => expect(screen.queryByText('Task number 0')).toBeNull())
    expect(screen.getAllByText(/^Task number 29\d\d$|^Task number 30\d\d$/).length).toBeGreaterThan(0)
  })

  it('collapses a group and expands subtasks in place', async () => {
    const parent = task(1, { subtask_count: 1 })
    const child = task(2, { parent_id: 't1', title: 'A subtask' })
    renderList([parent, child, task(3, { status_id: 'done', title: 'Finished thing' })])
    await screen.findByText('Task number 1')
    expect(screen.queryByText('A subtask')).toBeNull()
    const row = screen.getByText('Task number 1').closest('.grid') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Expand subtasks' }))
    expect(screen.getByText('A subtask')).toBeTruthy()

    // the group header comes before the rows' own status badges
    fireEvent.click(screen.getAllByText('To do')[0].closest('button')!)
    expect(screen.queryByText('Task number 1')).toBeNull()
    expect(screen.getByText('Finished thing')).toBeTruthy()
  })
})

// ---------------------------------------------------------------- RichEditor on Tiptap 3 (ADR-011)

describe('RichEditor', () => {
  it('loads the description and follows external changes without saving them back', async () => {
    const onSave = vi.fn()
    const { container, rerender } = render(<RichEditor value="<p>Call the client</p>" onSave={onSave} />)
    await waitFor(() => expect(container.querySelector('.ProseMirror')?.textContent).toBe('Call the client'))
    rerender(<RichEditor value="<p>Send the contract</p>" onSave={onSave} />)
    await waitFor(() => expect(container.querySelector('.ProseMirror')?.textContent).toBe('Send the contract'))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows the placeholder when empty and keeps the toolbar in sync', async () => {
    const { container } = render(<RichEditor value="" onSave={() => {}} placeholder="Add a description…" />)
    await waitFor(() => expect(container.querySelector('[data-placeholder="Add a description…"]')).toBeTruthy())
    const bold = screen.getByRole('button', { name: 'Bold' })
    expect(bold.className).not.toContain('bg-hover text-fg')
    await act(async () => fireEvent.click(bold))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bold' }).className).toContain('bg-hover text-fg'))
  })

  it('links are part of StarterKit and keep their address', async () => {
    const { container } = render(<RichEditor value={'<p><a href="https://example.com">site</a></p>'} onSave={() => {}} />)
    await waitFor(() => expect(container.querySelector('.ProseMirror a')?.getAttribute('href')).toBe('https://example.com'))
  })
})

// ---------------------------------------------------------------- EmailBody (ADR-010 images, ADR-001 privacy)

describe('EmailBody', () => {
  it('renders resolved inline images and blocks remote ones by default', async () => {
    handlers.getSettings = () => ({ mail: { loadRemoteImages: false } })
    const html = '<p>Hi</p><img src="data:image/png;base64,iVBORw0KGgo="><img src="https://tracker.example.com/p.gif">'
    withQueries(<EmailBody html={html} text="Hi" />)
    const frame = (await screen.findByTitle('Email content')) as HTMLIFrameElement
    const doc = frame.getAttribute('srcdoc')!
    expect(doc).toContain("img-src data: ;")
    expect(doc).toContain('data:image/png;base64,iVBORw0KGgo=')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts')
    expect(screen.getByText(/Remote images are hidden/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show images' }))
    expect((screen.getByTitle('Email content') as HTMLIFrameElement).getAttribute('srcdoc')).toContain('img-src data: https: http:')
  })

  it('shows plain text with clickable links when there is no HTML', () => {
    handlers.getSettings = () => ({ mail: { loadRemoteImages: false } })
    withQueries(<EmailBody html={null} text="See https://example.com/doc please" />)
    expect(screen.getByRole('link', { name: 'https://example.com/doc' }).getAttribute('href')).toBe('https://example.com/doc')
  })
})
