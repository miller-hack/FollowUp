import type { FollowUpDraft, MailAddress } from '@shared/mail'
import { all, get } from '../../db'
import { aiDraftFollowUp } from '../ai/features'
import { getAccountFull } from './accounts'
import { isOurs, ourIdentity } from './followups'
import { personalize } from './templates'

/**
 * A ready-to-edit follow-up email for a conversation in Follow-up (ADR-015).
 * Nothing is sent: the user reviews, edits and clicks Send.
 */

interface MsgRow {
  id: string
  from_name: string
  from_addr: string
  to_addrs: string
  cc_addrs: string
  subject: string
  is_auto: number
}

const TEMPLATES = {
  reply: 'Hi {{first_name}},\n\nThank you for your email, and sorry for the delay in getting back to you.\n\n\n\nBest regards,\n',
  nudge:
    'Hi {{first_name}},\n\nI wanted to follow up on my email below about “{{subject}}”. Could you let me know where things stand, or whether you need anything else from me?\n\nBest regards,\n'
}

/** Who to write to and which message to answer. */
export function followUpTarget(threadId: string): Omit<FollowUpDraft, 'body' | 'source' | 'ai_error'> & { kind: 'reply' | 'nudge'; greet: MailAddress | null } {
  const th = get<{ account_id: string; subject: string; followup_kind: 'reply' | 'nudge' | null; followup_anchor: string | null }>(
    'SELECT account_id, subject, followup_kind, followup_anchor FROM mail_threads WHERE id = ?',
    threadId
  )
  if (!th) throw new Error('Email thread not found')
  const ours = ourIdentity()
  const msgs = all<MsgRow>('SELECT id, from_name, from_addr, to_addrs, cc_addrs, subject, is_auto FROM mail_messages WHERE thread_id = ? ORDER BY date', threadId)
  const anchor = msgs.find((m) => m.id === th.followup_anchor) ?? [...msgs].reverse().find((m) => !m.is_auto) ?? msgs.at(-1)
  if (!anchor) throw new Error('This conversation has no messages')
  const kind = th.followup_kind ?? (isOurs(anchor.from_addr, ours) ? 'nudge' : 'reply')
  const parse = (j: string) => JSON.parse(j) as MailAddress[]
  const outside = (list: MailAddress[]) => list.filter((a) => !isOurs(a.address, ours))
  let to: MailAddress[]
  let cc: MailAddress[]
  if (kind === 'reply') {
    to = [{ name: anchor.from_name, address: anchor.from_addr }]
    cc = outside([...parse(anchor.to_addrs), ...parse(anchor.cc_addrs)]).filter((a) => a.address !== anchor.from_addr)
  } else {
    to = outside(parse(anchor.to_addrs))
    cc = outside(parse(anchor.cc_addrs))
    if (!to.length) [to, cc] = [cc, []]
  }
  const fmt = (list: MailAddress[]) => [...new Map(list.map((a) => [a.address, a])).values()].map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ')
  const subject = th.subject || anchor.subject
  return {
    kind,
    account_id: th.account_id,
    to: fmt(to),
    cc: fmt(cc),
    subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
    reply_to: anchor.id,
    greet: to[0] ?? null
  }
}

/** Client context for the AI: the company, its stage, and the latest logged interactions. */
function clientContext(addresses: string[]): string {
  for (const addr of addresses) {
    const c = get<{ id: string; name: string; stage: string | null; next_action: string }>(
      `SELECT c.id, c.name, st.name stage, c.next_action FROM companies c LEFT JOIN crm_stages st ON st.id = c.stage_id
       WHERE c.id = COALESCE((SELECT company_id FROM people WHERE email = ? LIMIT 1),
                             (SELECT id FROM companies WHERE domains LIKE '%"' || ? || '"%' LIMIT 1))`,
      addr,
      addr.split('@')[1] ?? ''
    )
    if (!c) continue
    const recent = all<{ kind: string; at: string; title: string; summary: string }>(
      'SELECT kind, at, title, summary FROM interactions WHERE company_id = ? ORDER BY at DESC LIMIT 5',
      c.id
    )
    return [
      `Client: ${c.name}${c.stage ? ` (stage: ${c.stage})` : ''}`,
      c.next_action && `Our next action: ${c.next_action}`,
      recent.length && `Recent contact:\n${recent.map((r) => `- ${r.at.slice(0, 10)} ${r.kind}${r.title ? ` “${r.title}”` : ''}: ${r.summary.slice(0, 300)}`).join('\n')}`
    ]
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

export async function draftFollowUp(threadId: string, instructions = ''): Promise<FollowUpDraft> {
  const t = followUpTarget(threadId)
  const acc = getAccountFull(t.account_id)
  const senderName = acc?.name && acc.name !== acc.email ? acc.name : ''
  const base = { account_id: t.account_id, to: t.to, cc: t.cc, subject: t.subject, reply_to: t.reply_to }
  try {
    const addresses = [...t.to.matchAll(/[^\s<>,]+@[^\s<>,]+/g)].map((m) => m[0].toLowerCase())
    const body = await aiDraftFollowUp(threadId, t.kind, senderName, clientContext(addresses), instructions)
    return { ...base, body, source: 'ai' }
  } catch (e) {
    const plain = t.subject.replace(/^re:\s*/i, '')
    const body = personalize(TEMPLATES[t.kind], t.greet, plain) + (senderName || '')
    return { ...base, body, source: 'template', ai_error: (e as Error).message }
  }
}
