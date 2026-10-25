import { create } from 'zustand'
import type { NewTask } from '@shared/types'

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'error' | 'success'
}

export interface ComposeDraft {
  account_id?: string
  to: string
  cc?: string
  subject: string
  body: string
  /** message row id being replied to (threads the reply) */
  reply_to?: string | null
  /** the saved draft being edited (replaced on save, removed on send) */
  draft_id?: string | null
}

interface UiState {
  compose: ComposeDraft | null
  openCompose: (draft?: Partial<ComposeDraft>) => void
  closeCompose: () => void
  openTaskId: string | null
  quickAdd: Partial<NewTask> | null
  paletteOpen: boolean
  toasts: Toast[]
  /** List of the location currently on screen; default target for new tasks. */
  contextListId: string | null
  /** Sprint on screen; new tasks join it. */
  contextSprintId: string | null
  /** AI assistant side panel */
  assistantOpen: boolean
  assistantChatId: string | null
  /** text placed in the assistant input when it opens */
  assistantPrefill: string
  openAssistant: (opts?: { chatId?: string | null; prefill?: string }) => void
  closeAssistant: () => void
  setAssistantChat: (id: string | null) => void
  openTask: (id: string | null) => void
  openQuickAdd: (defaults?: Partial<NewTask>) => void
  closeQuickAdd: () => void
  setPalette: (open: boolean) => void
  dismissToast: (id: number) => void
}

export const useUi = create<UiState>((set) => ({
  compose: null,
  openCompose: (draft = {}) => set({ compose: { to: '', subject: '', body: '', ...draft } }),
  closeCompose: () => set({ compose: null }),
  openTaskId: null,
  quickAdd: null,
  paletteOpen: false,
  toasts: [],
  contextListId: null,
  contextSprintId: null,
  assistantOpen: false,
  assistantChatId: null,
  assistantPrefill: '',
  openAssistant: (opts = {}) =>
    set((s) => ({
      assistantOpen: true,
      assistantChatId: opts.chatId !== undefined ? opts.chatId : s.assistantChatId,
      assistantPrefill: opts.prefill ?? ''
    })),
  closeAssistant: () => set({ assistantOpen: false }),
  setAssistantChat: (id) => set({ assistantChatId: id }),
  openTask: (id) => set({ openTaskId: id }),
  openQuickAdd: (defaults = {}) => set({ quickAdd: defaults }),
  closeQuickAdd: () => set({ quickAdd: null }),
  setPalette: (open) => set({ paletteOpen: open }),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

let toastId = 0
export function toast(message: string, kind: Toast['kind'] = 'info'): void {
  const id = ++toastId
  useUi.setState((s) => ({ toasts: [...s.toasts, { id, message, kind }] }))
  setTimeout(() => useUi.getState().dismissToast(id), kind === 'error' ? 6000 : 3000)
}
