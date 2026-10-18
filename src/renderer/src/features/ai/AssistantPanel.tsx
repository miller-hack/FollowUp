import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { AlertTriangle, Check, ChevronDown, Loader2, MessageSquarePlus, Search, Send, Sparkles, Square, Trash2, Wrench, X } from 'lucide-react'
import type { ChatDetail, ChatMessageView, ChatToolCall } from '@shared/ai'
import { api } from '@/lib/api'
import { useAiReady, useChat, useChats } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'
import { Button, IconButton, MenuItem, MenuSeparator, Popover } from '@/components/ui'
import { Markdown } from './Markdown'
import { useAiStream } from './stream'

const SUGGESTIONS = [
  'What should I work on today?',
  'Summarize my overdue tasks',
  'Which emails need a reply?',
  'What’s on my calendar this week?'
]

export function AssistantPanel() {
  const open = useUi((s) => s.assistantOpen)
  if (!open) return null
  return <Panel />
}

function Panel() {
  const navigate = useNavigate()
  const chatId = useUi((s) => s.assistantChatId)
  const prefill = useUi((s) => s.assistantPrefill)
  const { closeAssistant, setAssistantChat } = useUi.getState()
  const ready = useAiReady()
  const { data: chats = [] } = useChats()
  const { data: chat } = useChat(chatId)
  const streaming = useAiStream((s) => (chatId ? s.text[chatId] : undefined))
  const [input, setInput] = useState(prefill)
  const [sending, setSending] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (prefill) {
      setInput(prefill)
      inputRef.current?.focus()
    }
  }, [prefill])

  // keep the newest content in view while the assistant writes
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat?.messages.length, streaming, chat?.status])

  useEffect(() => {
    // the open conversation was deleted elsewhere
    if (chatId && chat === null) setAssistantChat(null)
  }, [chat, chatId, setAssistantChat])

  const busy = chat?.status === 'running'
  const send = async (text = input) => {
    if (!text.trim() || busy || sending) return
    setSending(true)
    try {
      const id = await api.sendChat(chatId, text)
      setAssistantChat(id)
      setInput('')
    } finally {
      setSending(false)
    }
  }

  return (
    // floats over the page (like the task panel) so wide pages such as the inbox keep their layout
    <aside className="fixed top-0 right-0 bottom-0 z-[25] flex w-[min(420px,92vw)] flex-col border-l border-line bg-panel shadow-2xl" aria-label="AI assistant">
      <header className="flex items-center gap-1 border-b border-line px-3 py-2">
        <Sparkles size={15} className="shrink-0 text-accent" />
        <Popover
          triggerClassName="min-w-0 flex-1"
          className="w-80"
          trigger={
            <button type="button" className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left font-medium hover:bg-hover">
              <span className="truncate">{chat?.title ?? 'New conversation'}</span>
              <ChevronDown size={13} className="shrink-0 text-muted" />
            </button>
          }
        >
          {(close) => (
            <div className="max-h-80 overflow-auto">
              <MenuItem icon={<MessageSquarePlus size={14} />} onClick={() => (setAssistantChat(null), close())}>
                New conversation
              </MenuItem>
              {chats.length > 0 && <MenuSeparator />}
              {chats.map((c) => (
                <MenuItem key={c.id} active={c.id === chatId} onClick={() => (setAssistantChat(c.id), close())}>
                  <span className="block truncate">{c.title}</span>
                  <span className="block text-[11px] text-muted">{formatDistanceToNow(new Date(c.updated_at), { addSuffix: true })}</span>
                </MenuItem>
              ))}
            </div>
          )}
        </Popover>
        <IconButton label="New conversation" onClick={() => setAssistantChat(null)}>
          <MessageSquarePlus size={15} />
        </IconButton>
        {chat && (
          <IconButton
            label="Delete conversation"
            onClick={async () => {
              if (!window.confirm('Delete this conversation?')) return
              await api.deleteChat(chat.id)
              setAssistantChat(null)
            }}
          >
            <Trash2 size={14} />
          </IconButton>
        )}
        <IconButton label="Close assistant (Ctrl+J)" onClick={closeAssistant}>
          <X size={15} />
        </IconButton>
      </header>

      <div ref={scroller} className="flex-1 space-y-4 overflow-auto px-4 py-4 text-[13px]">
        {!ready ? (
          <div className="rounded-lg border border-line p-4 text-center">
            <Sparkles size={22} className="mx-auto text-accent" />
            <p className="mt-2 font-medium">Set up AI to use the assistant</p>
            <p className="mt-1 text-xs text-muted">Add a Claude or OpenAI API key, or point FollowUp at a local Ollama server.</p>
            <Button variant="primary" className="mt-3" onClick={() => navigate('/settings#ai')}>
              Open AI settings
            </Button>
          </div>
        ) : !chat ? (
          <div className="pt-6 text-center">
            <Sparkles size={26} className="mx-auto text-accent" />
            <p className="mt-2 font-medium">Ask about your tasks, email and calendar</p>
            <p className="mt-1 text-xs text-muted">The assistant can look things up for you. Changes need your approval, and it never sends email by itself.</p>
            <div className="mt-4 flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="rounded-md border border-line px-3 py-1.5 text-left hover:bg-hover">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {chat.messages.map((m) => (
              <Message key={m.id} m={m} chat={chat} />
            ))}
            {streaming && (
              <div className="text-fg">
                <Markdown text={streaming} />
              </div>
            )}
            {busy && !streaming && (
              <div className="flex items-center gap-2 text-muted">
                <Loader2 size={14} className="animate-spin" /> Thinking…
              </div>
            )}
            {chat.status === 'error' && chat.error && (
              <div className="flex items-start gap-2 rounded-md border border-danger/40 px-3 py-2 text-danger">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span className="flex-1">{chat.error}</span>
              </div>
            )}
          </>
        )}
      </div>

      <footer className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-lg border border-line bg-panel px-2 py-1.5 focus-within:border-accent">
          <textarea
            ref={inputRef}
            value={input}
            disabled={!ready}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            rows={Math.min(6, Math.max(1, input.split('\n').length))}
            placeholder={chat?.status === 'awaiting_approval' ? 'Reply (declines the pending actions)…' : 'Ask the assistant…'}
            aria-label="Message the assistant"
            className="max-h-40 flex-1 resize-none bg-transparent py-1 text-[13px] outline-none placeholder:text-muted"
          />
          {busy ? (
            <IconButton label="Stop" onClick={() => chat && api.stopChat(chat.id)}>
              <Square size={14} />
            </IconButton>
          ) : (
            <IconButton label="Send (Enter)" disabled={!input.trim() || sending || !ready} onClick={() => send()} className="text-accent">
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </IconButton>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-muted">AI can make mistakes. Check important details.</p>
      </footer>
    </aside>
  )
}

function Message({ m, chat }: { m: ChatMessageView; chat: ChatDetail }) {
  if (m.role === 'user')
    return (
      <div className="ml-10 rounded-lg bg-accent/10 px-3 py-2 whitespace-pre-wrap select-text">{m.text}</div>
    )
  const pending = m.toolCalls.filter((t) => t.status === 'pending')
  return (
    <div className="space-y-2 select-text">
      {m.text && <Markdown text={m.text} />}
      {m.toolCalls.map((tc) => (tc.needsApproval ? <ApprovalCard key={tc.id} tc={tc} chatId={chat.id} /> : <ToolLine key={tc.id} tc={tc} />))}
      {pending.length > 1 && chat.status === 'awaiting_approval' && (
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={() => api.resolveChatTools(chat.id, Object.fromEntries(pending.map((t) => [t.id, false])))}>
            Decline all
          </Button>
          <Button size="sm" variant="primary" onClick={() => api.resolveChatTools(chat.id, Object.fromEntries(pending.map((t) => [t.id, true])))}>
            Approve all ({pending.length})
          </Button>
        </div>
      )}
      {m.notice && <div className="text-xs text-muted italic">{m.notice}</div>}
    </div>
  )
}

/** Read-only lookups appear as a compact line. */
function ToolLine({ tc }: { tc: ChatToolCall }) {
  return (
    <div className={cn('flex items-center gap-1.5 text-xs', tc.status === 'error' ? 'text-danger' : 'text-muted')} title={tc.result}>
      {tc.status === 'running' ? <Loader2 size={12} className="animate-spin" /> : tc.name === 'draft_email' ? <Send size={12} /> : <Search size={12} />}
      <span className="truncate">{tc.summary}</span>
      {tc.status === 'error' && <span>· failed</span>}
    </div>
  )
}

const STATUS_LABEL: Partial<Record<ChatToolCall['status'], string>> = {
  approved: 'Approved',
  declined: 'Declined',
  running: 'Running…',
  done: 'Done',
  error: 'Failed'
}

function ApprovalCard({ tc, chatId }: { tc: ChatToolCall; chatId: string }) {
  const [details, setDetails] = useState(false)
  return (
    <div className={cn('rounded-lg border px-3 py-2', tc.status === 'pending' ? 'border-accent/60 bg-accent/5' : 'border-line')}>
      <div className="flex items-start gap-2">
        <Wrench size={13} className="mt-0.5 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{tc.summary}</div>
          <button type="button" className="text-[11px] text-muted hover:text-fg" onClick={() => setDetails(!details)}>
            {details ? 'Hide details' : 'Details'}
          </button>
        </div>
        {tc.status !== 'pending' && (
          <span
            className={cn(
              'flex shrink-0 items-center gap-1 text-[11px]',
              tc.status === 'done' ? 'text-emerald-600' : tc.status === 'error' ? 'text-danger' : 'text-muted'
            )}
          >
            {tc.status === 'done' && <Check size={12} />}
            {STATUS_LABEL[tc.status]}
          </span>
        )}
      </div>
      {details && (
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-hover p-2 font-mono text-[11px] whitespace-pre-wrap">{JSON.stringify(tc.input, null, 2)}</pre>
      )}
      {tc.status === 'error' && tc.result && <div className="mt-1 text-xs text-danger">{tc.result}</div>}
      {tc.status === 'pending' && (
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" onClick={() => api.resolveChatTools(chatId, { [tc.id]: false })}>
            Decline
          </Button>
          <Button size="sm" variant="primary" onClick={() => api.resolveChatTools(chatId, { [tc.id]: true })}>
            Approve
          </Button>
        </div>
      )}
    </div>
  )
}
