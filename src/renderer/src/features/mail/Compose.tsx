import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { FileText, Send } from 'lucide-react'
import type { MailMessage, ThreadDetail } from '@shared/mail'
import { api } from '@/lib/api'
import { useAccounts, useEmailTemplates } from '@/lib/hooks'
import { toast, useUi, type ComposeDraft } from '@/stores/ui'
import { Button, Input, Modal } from '@/components/ui'
import { Select } from '@/components/selects'

/** Quotes names with commas, brackets etc. so they can't be read as extra recipients. */
const fmtAddr = (a: { name: string; address: string }) => {
  const name = a.name && a.name !== 'me' ? a.name.replace(/[\r\n"\\]/g, '').trim() : ''
  if (!name) return a.address
  return /[,;<>()@:[\]]/.test(name) ? `"${name}" <${a.address}>` : `${name} <${a.address}>`
}

function quote(m: MailMessage): string {
  const lines = (m.body_text || '').trim().split(/\r?\n/).slice(0, 60)
  return `\n\nOn ${format(new Date(m.date), 'EEE, MMM d, yyyy HH:mm')}, ${m.from.name || m.from.address} wrote:\n${lines.map((l) => `> ${l}`).join('\n')}`
}

const reSubject = (s: string) => (/^re:/i.test(s) ? s : `Re: ${s}`)

/** Draft for replying to a message (reply-all includes everyone except you). */
export function replyDraft(thread: ThreadDetail, m: MailMessage, all: boolean, myEmail: string): ComposeDraft {
  const me = myEmail.toLowerCase()
  const to = m.is_outbound ? m.to : [m.from, ...(all ? m.to : [])]
  const cc = all ? m.cc : []
  const uniq = (xs: typeof to) => [...new Map(xs.filter((a) => a.address !== me).map((a) => [a.address, a])).values()]
  return {
    account_id: thread.account_id,
    to: uniq(to).map(fmtAddr).join(', '),
    cc: uniq(cc).map(fmtAddr).join(', '),
    subject: reSubject(m.subject || thread.subject),
    body: quote(m),
    reply_to: m.id
  }
}

export function forwardDraft(thread: ThreadDetail, m: MailMessage): ComposeDraft {
  return {
    account_id: thread.account_id,
    to: '',
    subject: /^fwd?:/i.test(m.subject) ? m.subject : `Fwd: ${m.subject || thread.subject}`,
    body: `\n\n---------- Forwarded message ----------\nFrom: ${fmtAddr(m.from)}\nDate: ${format(new Date(m.date), 'EEE, MMM d, yyyy HH:mm')}\nSubject: ${m.subject}\nTo: ${m.to.map(fmtAddr).join(', ')}\n\n${m.body_text}`,
    reply_to: null
  }
}

export function ComposeDialog() {
  const draft = useUi((s) => s.compose)
  const close = useUi((s) => s.closeCompose)
  const { data: accounts = [] } = useAccounts()
  const { data: templates = [] } = useEmailTemplates()
  const mailAccounts = accounts.filter((a) => a.kind === 'mail')
  const [d, setD] = useState<ComposeDraft | null>(draft)
  const [showCc, setShowCc] = useState(false)
  const [sending, setSending] = useState(false)
  const [saving, setSaving] = useState(false)
  // Ctrl+Enter and the button can both fire before React re-renders: guard with a ref (ADR-004)
  const sendingRef = useRef(false)

  useEffect(() => {
    setD(draft ? { ...draft, account_id: draft.account_id ?? mailAccounts[0]?.id } : null)
    setShowCc(!!draft?.cc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  if (!draft || !d) return null
  const set = (p: Partial<ComposeDraft>) => setD({ ...d, ...p })
  // accounts may load after the draft opened
  const accountId = d.account_id ?? mailAccounts[0]?.id
  const dirty = d.to !== draft.to || d.subject !== draft.subject || d.body !== draft.body || (d.cc ?? '') !== (draft.cc ?? '')

  const send = async () => {
    if (!accountId || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    try {
      await api.sendEmail({ account_id: accountId, to: d.to, cc: d.cc, subject: d.subject, body: d.body, reply_to: d.reply_to, draft_id: d.draft_id })
      toast('Sending…', 'success')
      close()
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  return (
    <Modal
      title={d.draft_id ? 'Draft' : d.reply_to ? 'Reply' : 'New email'}
      onClose={close}
      confirmDiscard={dirty}
      width={680}
      footer={
        <>
          {templates.length > 0 && (
            <Select
              value=""
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value)
                if (t) set({ subject: d.subject || t.subject, body: `${t.body}${d.body}` })
              }}
              className="mr-auto"
              aria-label="Insert template"
            >
              <option value="">Insert template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          )}
          <Button variant="ghost" onClick={close}>Discard</Button>
          <Button
            variant="ghost"
            disabled={saving || !accountId || (!d.to.trim() && !d.body.trim())}
            onClick={async () => {
              if (!accountId) return
              setSaving(true)
              try {
                await api.saveDraft({ account_id: accountId, to: d.to, cc: d.cc, subject: d.subject, body: d.body, reply_to: d.reply_to }, d.draft_id)
                toast('Saved in Drafts', 'success')
                close()
              } finally {
                setSaving(false)
              }
            }}
          >
            Save draft
          </Button>
          <Button variant="primary" onClick={send} disabled={sending || !d.to.trim() || !accountId}>
            <Send size={14} /> Send
          </Button>
        </>
      }
    >
      {mailAccounts.length === 0 ? (
        <p className="text-muted">Add an email account in Settings first.</p>
      ) : (
        <div className="space-y-2 text-[13px]" onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && void send()}>
          <div className="grid grid-cols-[56px_1fr] items-center gap-2">
            <span className="text-muted">From</span>
            <Select value={accountId} onChange={(e) => set({ account_id: e.target.value })} aria-label="From">
              {mailAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name} &lt;{a.email}&gt;</option>
              ))}
            </Select>
            <span className="text-muted">To</span>
            <div className="flex gap-2">
              <Input autoFocus={!d.to} value={d.to} onChange={(e) => set({ to: e.target.value })} placeholder="name@example.com, …" aria-label="To" />
              {!showCc && (
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setShowCc(true)}>Cc</Button>
              )}
            </div>
            {showCc && (
              <>
                <span className="text-muted">Cc</span>
                <Input value={d.cc ?? ''} onChange={(e) => set({ cc: e.target.value })} aria-label="Cc" />
              </>
            )}
            <span className="text-muted">Subject</span>
            <Input value={d.subject} onChange={(e) => set({ subject: e.target.value })} aria-label="Subject" />
          </div>
          <textarea
            autoFocus={!!d.to}
            value={d.body}
            onChange={(e) => set({ body: e.target.value })}
            onFocus={(e) => d.reply_to && e.currentTarget.setSelectionRange(0, 0)}
            rows={14}
            aria-label="Message"
            placeholder="Write your message…"
            className="w-full resize-y rounded-md border border-line bg-panel px-3 py-2 leading-relaxed outline-none focus:border-accent"
          />
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <FileText size={12} /> Ctrl+Enter to send. Lines starting with “&gt;” are shown as a quote.
          </p>
        </div>
      )}
    </Modal>
  )
}
