import { create } from 'zustand'
import type { AiEvent } from '@shared/ai'
import { queryClient } from '@/lib/hooks'

/** Text the assistant is streaming right now, per conversation (not yet saved as a message). */
export const useAiStream = create<{ text: Record<string, string> }>(() => ({ text: {} }))

export function handleAiEvent(e: AiEvent): void {
  const id = e.conversationId
  if (e.kind === 'delta') {
    useAiStream.setState((s) => ({ text: { ...s.text, [id]: (s.text[id] ?? '') + e.text } }))
    return
  }
  // A turn finished: refetch, then drop only the streamed text the saved message now contains
  // (deltas of the next turn may already be arriving).
  const shown = useAiStream.getState().text[id]?.length ?? 0
  void Promise.all([
    queryClient.invalidateQueries({ queryKey: ['chat', id] }),
    queryClient.invalidateQueries({ queryKey: ['chats'] })
  ]).finally(() =>
    useAiStream.setState((s) => {
      const rest = (s.text[id] ?? '').slice(shown)
      const text = { ...s.text }
      if (rest) text[id] = rest
      else delete text[id]
      return { text }
    })
  )
}
