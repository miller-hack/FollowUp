import { useEffect, useRef, useState } from 'react'
import { addDays, differenceInCalendarDays, format, nextMonday, setHours, setMinutes, startOfDay } from 'date-fns'
import { AlarmClock, BellOff, Clock, Loader2, RotateCcw, Send, Sparkles, Undo2 } from 'lucide-react'
import type { FollowUpDraft, FollowUpInfo, ThreadDetail } from '@shared/mail'
import { api } from '@/lib/api'
import { useAiReady } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { toast } from '@/stores/ui'
import { Button, Input, MenuItem, Popover } from '@/components/ui'

/** "for 3 days", "since yesterday", "since today" */
function age(since: string): string {
  const days = differenceInCalendarDays(new Date(), new Date(since))
  return days <= 0 ? 'since today' : days === 1 ? 'since yesterday' : `for ${days} days`
}

export function waitingText(f: FollowUpInfo): string {
  return f.kind === 'reply' ? `Waiting for your reply ${age(f.since)}` : `No answer to your email ${age(f.since)}`
}

export function FollowUpBadge({ f }: { f: FollowUpInfo }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 text-[11px] text-amber-700 dark:text-amber-300">
      <Clock size={10} /> {f.kind === 'reply' ? 'Reply needed' : 'Waiting on them'}
    </span>
  )
}

const at9 = (d: Date) => setMinutes(setHours(startOfDay(d), 9), 0)

/**
 * Shown above a conversation that is (or will be) in Follow-up (ADR-015): why, snooze, dismiss,
 * and the follow-up email: AI-written from the thread when AI is set up, a template otherwise.
 * Nothing is sent until Send is clicked.
 */
export function FollowUpPanel({ thread, autoDraft }: { thread: ThreadDetail; autoDraft: boolean }) {
  const f = thread.followup!
  const aiReady = useAiReady()
  const [draft, setDraft] = useState<FollowUpDraft | null>(null)
  const [loading, setLoading] = useState(false)
  const [instructions, setInstructions] = useState('')
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const asked = useRef(false)

  const write = async (extra = '') => {
    setLoading(true)
    try {
      setDraft(await api.getFollowUpDraft(thread.id, extra))
    } finally {
      setLoading(false)
    }
  }

  // in the Follow-up view, the draft is written as soon as the conversation is opened
  useEffect(() => {
    if (autoDraft && f.due && !asked.current) {
      asked.current = true
      void write()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDraft, f.due])

  const send = async () => {
    if (!draft || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    try {
      await api.sendEmail({ account_id: draft.account_id, to: draft.to, cc: draft.cc, subject: draft.subject, body: draft.body, reply_to: draft.reply_to })
      toast('Follow-up sent', 'success')
      setDraft(null)
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const snooze = async (until: Date, label: string) => {
    await api.snoozeFollowUp(thread.id, until.toISOString())
    toast(`Snoozed until ${label}`, 'success')
  }

  const snoozed = f.snoozed_until && new Date(f.snoozed_until) > new Date()
  const headline = f.kind === 'reply' ? 'They’re waiting for your reply' : 'You’re waiting for their answer'
  const detail = f.dismissed
    ? 'You marked this as not needing a follow-up. It comes back if a new message arrives.'
    : snoozed
      ? `Snoozed until ${format(new Date(f.snoozed_until!), 'EEE MMM d, HH:mm')}.`
      : f.due
        ? `${f.kind === 'reply' ? 'Their last email' : 'Your last email'} was ${format(new Date(f.since), 'EEE MMM d, HH:mm')}.`
        : `Moves to Follow-up on ${format(new Date(f.due_at), 'EEE MMM d, HH:mm')} if nobody answers.`

  return (
    <section className={cn('rounded-xl border px-4 py-3', f.due && !f.dismissed && !snoozed ? 'border-amber-500/40 bg-amber-500/5' : 'border-line bg-hover/40')}>
      <div className="flex flex-wrap items-center gap-2">
        <Clock size={15} className="text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{headline}</div>
          <div className="text-xs text-muted">{detail}</div>
        </div>
        {!draft && !f.dismissed && (
          <Button size="sm" variant="primary" disabled={loading} onClick={() => write()}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Write follow-up
          </Button>
        )}
        {!f.dismissed && !snoozed && (
          <Popover
            align="end"
            trigger={
              <Button size="sm" variant="ghost">
                <AlarmClock size={13} /> Snooze
              </Button>
            }
          >
            {(close) => (
              <div className="w-48">
                {[
                  { label: 'Tomorrow 9:00', at: at9(addDays(new Date(), 1)) },
                  { label: 'In 3 days', at: at9(addDays(new Date(), 3)) },
                  { label: 'Next Monday 9:00', at: at9(nextMonday(new Date())) },
                  { label: 'In 2 weeks', at: at9(addDays(new Date(), 14)) }
                ].map((o) => (
                  <MenuItem key={o.label} onClick={() => (close(), void snooze(o.at, o.label.toLowerCase()))}>
                    {o.label}
                  </MenuItem>
                ))}
              </div>
            )}
          </Popover>
        )}
        {f.dismissed || snoozed ? (
          <Button size="sm" variant="ghost" onClick={() => api.restoreFollowUp(thread.id)}>
            <RotateCcw size={13} /> Bring back
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => api.dismissFollowUp(thread.id)} title="Hide it from Follow-up until a new message arrives">
            <BellOff size={13} /> No follow-up needed
          </Button>
        )}
      </div>

      {loading && !draft && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted">
          <Loader2 size={13} className="animate-spin" /> {aiReady ? 'Writing a follow-up from the conversation…' : 'Preparing a follow-up…'}
        </p>
      )}

      {draft && (
        <div className="mt-3 space-y-2 border-t border-line pt-3 text-[13px]">
          <p className={cn('text-xs', draft.source === 'ai' ? 'text-accent' : 'text-muted')}>
            {draft.source === 'ai'
              ? 'Written by AI from the whole conversation. Check it before sending.'
              : `A starting point to edit${draft.ai_error ? ` (AI isn’t available: ${draft.ai_error})` : ''}.`}
          </p>
          <div className="grid grid-cols-[48px_1fr] items-center gap-2">
            <span className="text-xs text-muted">To</span>
            <Input value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} aria-label="Follow-up to" />
            <span className="text-xs text-muted">Cc</span>
            <Input value={draft.cc} onChange={(e) => setDraft({ ...draft, cc: e.target.value })} aria-label="Follow-up cc" />
            <span className="text-xs text-muted">Subject</span>
            <Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} aria-label="Follow-up subject" />
          </div>
          <textarea
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            aria-label="Follow-up message"
            rows={Math.min(16, Math.max(6, draft.body.split('\n').length + 1))}
            className="w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 leading-relaxed outline-none focus:border-accent"
          />
          {aiReady && (
            <div className="flex gap-2">
              <Input
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Tell the AI what to change, e.g. “mention the meeting on Thursday”, “shorter”, “more formal”"
                onKeyDown={(e) => e.key === 'Enter' && !loading && void write(instructions)}
              />
              <Button size="sm" disabled={loading} onClick={() => write(instructions)}>
                {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Rewrite
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" disabled={sending || !draft.to.trim() || !draft.body.trim()} onClick={send}>
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send follow-up
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await api.saveDraft({ account_id: draft.account_id, to: draft.to, cc: draft.cc, subject: draft.subject, body: draft.body, reply_to: draft.reply_to })
                toast('Saved in Drafts', 'success')
                setDraft(null)
              }}
            >
              Save as draft
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              <Undo2 size={13} /> Discard
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
