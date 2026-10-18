/**
 * In-process domain events. Services emit; the automation engine listens.
 * Events are emitted inside the caller's transaction, so anything a listener
 * writes (e.g. queued jobs) commits or rolls back together with the change.
 */

export type DomainEvent =
  | { type: 'task.created'; taskId: string }
  | { type: 'task.status_changed'; taskId: string; from: string; to: string }
  | { type: 'task.priority_changed'; taskId: string; from: string; to: string }
  | { type: 'task.moved'; taskId: string; fromList: string; toList: string }
  | { type: 'task.tag_added'; taskId: string; tagId: string }
  | { type: 'task.comment_added'; taskId: string; commentId: string; author: string }
  | { type: 'task.checklist_completed'; taskId: string; checklistId: string }
  | { type: 'time.logged'; taskId: string }
  | { type: 'mail.received'; threadId: string; messageId: string }
  | { type: 'mail.triaged'; threadId: string; messageId: string; category: string }

/** How many automation hops led to this event (0 = caused by the user). */
export type EmittedEvent = DomainEvent & { depth: number }

type Listener = (e: EmittedEvent) => void
const listeners: Listener[] = []
let depth = 0

export function onEvent(l: Listener): () => void {
  listeners.push(l)
  return () => listeners.splice(listeners.indexOf(l), 1)
}

export function emit(e: DomainEvent): void {
  const ev = { ...e, depth }
  for (const l of listeners) l(ev)
}

/** Run `fn` with events attributed to automation depth `d`. */
export function withDepth<T>(d: number, fn: () => T): T {
  const prev = depth
  depth = d
  try {
    return fn()
  } finally {
    depth = prev
  }
}
