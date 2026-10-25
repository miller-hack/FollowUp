import type {
  ClientFilter,
  ClientSuggestion,
  Company,
  CompanyInput,
  CrmStage,
  Interaction,
  InteractionInput,
  Person,
  PersonInput,
  TeamMember,
  TimelineItem
} from '@shared/crm'
import type { MailAddress } from '@shared/mail'
import { isAppDate } from '@shared/dates'
import { all, get, marks, now, run, tx, uuid } from '../db'
import { createTask } from './tasks'
import { isFreeMailDomain, isOurs, ourIdentity } from './mail/followups'

/**
 * Clients (ADR-016): companies and their people, the relationship stage, who owns it on our
 * side, and the history. Calls, chats, meetings and events are logged as interactions with the
 * people who took part; emails come straight from the mail store (matched by address), so the
 * history is complete without copying anything.
 */

const clean = (s: unknown) => String(s ?? '').trim()
const lower = (s: unknown) => clean(s).toLowerCase()
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ---------------------------------------------------------------- stages & team

export function listStages(): CrmStage[] {
  return all<CrmStage>('SELECT id, name, color, kind, position FROM crm_stages ORDER BY position')
}

/** Replace the stage list (rename, recolour, reorder, add, remove). Companies on a removed stage keep no stage. */
export function saveStages(stages: Omit<CrmStage, 'position'>[]): CrmStage[] {
  if (!stages.length) throw new Error('Keep at least one stage')
  if (stages.some((s) => !clean(s.name))) throw new Error('Give every stage a name')
  tx(() => {
    const keep = stages.filter((s) => s.id).map((s) => s.id)
    run(`DELETE FROM crm_stages WHERE id NOT IN (${keep.length ? marks(keep.length) : "''"})`, ...keep)
    stages.forEach((s, i) => {
      if (s.id && get('SELECT 1 FROM crm_stages WHERE id = ?', s.id))
        run('UPDATE crm_stages SET name = ?, color = ?, kind = ?, position = ?, updated_at = ? WHERE id = ?', clean(s.name), s.color, s.kind, i + 1, now(), s.id)
      else run('INSERT INTO crm_stages (id, name, color, kind, position) VALUES (?, ?, ?, ?, ?)', s.id || uuid(), clean(s.name), s.color, s.kind, i + 1)
    })
  })
  return listStages()
}

/** The team; the first time, the user (named after their first mailbox) is added. */
export function listTeam(): TeamMember[] {
  const team = all<TeamMember>('SELECT id, name, email, position FROM team_members ORDER BY position, name')
  if (team.length) return team
  const acc = get<{ name: string; email: string }>("SELECT name, email FROM accounts WHERE kind = 'mail' ORDER BY created_at LIMIT 1")
  const me: TeamMember = { id: uuid(), name: acc?.name && acc.name !== acc.email ? acc.name : 'Me', email: acc?.email ?? '', position: 0 }
  run('INSERT INTO team_members (id, name, email, position) VALUES (?, ?, ?, ?)', me.id, me.name, me.email, 0)
  return [me]
}

export function saveTeamMember(input: Partial<TeamMember> & { name: string }): TeamMember {
  const name = clean(input.name)
  if (!name) throw new Error('Enter the team member’s name')
  const email = lower(input.email)
  if (email && !EMAIL.test(email)) throw new Error('Enter a valid email address')
  if (input.id && get('SELECT 1 FROM team_members WHERE id = ?', input.id)) {
    run('UPDATE team_members SET name = ?, email = ?, updated_at = ? WHERE id = ?', name, email, now(), input.id)
    return get<TeamMember>('SELECT id, name, email, position FROM team_members WHERE id = ?', input.id)!
  }
  const position = (get<{ p: number | null }>('SELECT MAX(position) p FROM team_members')?.p ?? -1) + 1
  const m: TeamMember = { id: uuid(), name, email, position }
  run('INSERT INTO team_members (id, name, email, position) VALUES (?, ?, ?, ?)', m.id, m.name, m.email, m.position)
  return m
}

export function deleteTeamMember(id: string): void {
  run('DELETE FROM team_members WHERE id = ?', id)
}

// ---------------------------------------------------------------- companies & people

interface CompanyRow extends Omit<Company, 'domains' | 'people' | 'last_contact'> {
  domains: string
}
interface PersonRow extends Omit<Person, 'other_emails' | 'action_owner' | 'last_contact' | 'responds' | 'emails_in' | 'emails_out' | 'interactions'> {
  other_emails: string
  action_owner: number
}

const PERSON_COLS = 'id, company_id, name, designation, phone, email, other_emails, action_owner, owner_id, next_action, next_action_due, notes, position'
const COMPANY_COLS = 'id, name, domains, type, stage_id, owner_id, next_action, next_action_due, notes, position'

/** Email and interaction activity per person (one query each, for the whole table). */
function activity(people: PersonRow[]): Map<string, Pick<Person, 'last_contact' | 'responds' | 'emails_in' | 'emails_out' | 'interactions'>> {
  const out = new Map<string, Pick<Person, 'last_contact' | 'responds' | 'emails_in' | 'emails_out' | 'interactions'>>()
  if (!people.length) return out
  const addrOf = new Map<string, string>()
  for (const p of people) for (const a of [p.email, ...(JSON.parse(p.other_emails) as string[])]) if (a) addrOf.set(a.toLowerCase(), p.id)
  const blank = () => ({ last_contact: null as string | null, responds: false, emails_in: 0, emails_out: 0, interactions: 0 })
  for (const p of people) out.set(p.id, blank())
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
  const addrs = [...addrOf.keys()]
  if (addrs.length) {
    // inbound: they wrote
    for (const r of all<{ addr: string; n: number; last: string }>(
      `SELECT from_addr addr, COUNT(*) n, MAX(date) last FROM mail_messages WHERE is_draft = 0 AND from_addr IN (${marks(addrs.length)}) GROUP BY from_addr`,
      ...addrs
    )) {
      const a = out.get(addrOf.get(r.addr)!)!
      a.emails_in += r.n
      if (!a.last_contact || r.last > a.last_contact) a.last_contact = r.last
      if (r.last >= since) a.responds = true
    }
    // outbound: we wrote to them (to or cc)
    for (const r of all<{ to_addrs: string; cc_addrs: string; date: string }>(
      `SELECT to_addrs, cc_addrs, date FROM mail_messages WHERE is_outbound = 1 AND is_draft = 0 AND (${addrs.map(() => 'to_addrs LIKE ? OR cc_addrs LIKE ?').join(' OR ')})`,
      ...addrs.flatMap((a) => [`%"${a}"%`, `%"${a}"%`])
    )) {
      for (const x of [...(JSON.parse(r.to_addrs) as MailAddress[]), ...(JSON.parse(r.cc_addrs) as MailAddress[])]) {
        const pid = addrOf.get(x.address.toLowerCase())
        if (!pid) continue
        const a = out.get(pid)!
        a.emails_out++
        if (!a.last_contact || r.date > a.last_contact) a.last_contact = r.date
      }
    }
  }
  const ids = people.map((p) => p.id)
  for (const r of all<{ person_id: string; n: number; last: string }>(
    `SELECT ip.person_id, COUNT(*) n, MAX(i.at) last FROM interaction_people ip JOIN interactions i ON i.id = ip.interaction_id
     WHERE ip.person_id IN (${marks(ids.length)}) GROUP BY ip.person_id`,
    ...ids
  )) {
    const a = out.get(r.person_id)!
    a.interactions = r.n
    // interaction times are local; good enough for "latest" ordering against UTC email dates
    if (!a.last_contact || r.last > a.last_contact) a.last_contact = r.last
  }
  return out
}

const toPerson = (r: PersonRow, act: ReturnType<typeof activity>): Person => ({
  ...r,
  other_emails: JSON.parse(r.other_emails) as string[],
  action_owner: !!r.action_owner,
  ...(act.get(r.id) ?? { last_contact: null, responds: false, emails_in: 0, emails_out: 0, interactions: 0 })
})

export function listClients(f: ClientFilter = {}): Company[] {
  const where: string[] = []
  const params: unknown[] = []
  if (f.stage_id) where.push('c.stage_id = ?'), params.push(f.stage_id)
  if (f.owner_id) where.push('(c.owner_id = ? OR EXISTS (SELECT 1 FROM people p WHERE p.company_id = c.id AND p.owner_id = ?))'), params.push(f.owner_id, f.owner_id)
  if (f.type) where.push('c.type = ?'), params.push(f.type)
  const q = clean(f.search).toLowerCase()
  if (q) {
    where.push(
      `(LOWER(c.name) LIKE ? OR LOWER(c.domains) LIKE ? OR EXISTS (SELECT 1 FROM people p WHERE p.company_id = c.id AND
        (LOWER(p.name) LIKE ? OR LOWER(p.email) LIKE ? OR LOWER(p.designation) LIKE ? OR p.phone LIKE ?)))`
    )
    const like = `%${q.replace(/[%_]/g, '')}%`
    params.push(like, like, like, like, like, like)
  }
  const companies = all<CompanyRow>(`SELECT ${COMPANY_COLS} FROM companies c ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.position, c.name COLLATE NOCASE`, ...params)
  if (!companies.length) return []
  const people = all<PersonRow>(`SELECT ${PERSON_COLS} FROM people WHERE company_id IN (${marks(companies.length)}) ORDER BY position, name COLLATE NOCASE`, ...companies.map((c) => c.id))
  const act = activity(people)
  const lastInteraction = new Map(
    all<{ company_id: string; last: string }>(`SELECT company_id, MAX(at) last FROM interactions WHERE company_id IN (${marks(companies.length)}) GROUP BY company_id`, ...companies.map((c) => c.id)).map((r) => [r.company_id, r.last])
  )
  return companies.map((c) => {
    const ps = people.filter((p) => p.company_id === c.id).map((p) => toPerson(p, act))
    const last = [lastInteraction.get(c.id) ?? null, ...ps.map((p) => p.last_contact)].filter(Boolean).sort().at(-1) ?? null
    return { ...c, domains: JSON.parse(c.domains) as string[], people: ps, last_contact: last }
  })
}

export function getCompany(id: string): Company | null {
  const c = get<CompanyRow>(`SELECT ${COMPANY_COLS} FROM companies WHERE id = ?`, id)
  if (!c) return null
  return listClients({}).find((x) => x.id === id) ?? null
}

function normDomains(list: unknown): string[] {
  const out = [...new Set((Array.isArray(list) ? list : []).map((d) => lower(d).replace(/^@/, '').replace(/^www\./, '')).filter(Boolean))]
  const bad = out.find((d) => !DOMAIN.test(d))
  if (bad) throw new Error(`“${bad}” is not a domain (use e.g. acme.com)`)
  return out
}

function checkDue(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (!isAppDate(v)) throw new Error('Choose a valid date for the next action')
  return v as string
}

export function createCompany(input: CompanyInput): Company {
  const name = clean(input.name)
  if (!name) throw new Error('Enter the company name')
  const id = uuid()
  const position = (get<{ p: number | null }>('SELECT MAX(position) p FROM companies')?.p ?? 0) + 1
  run(
    'INSERT INTO companies (id, name, domains, type, stage_id, owner_id, next_action, next_action_due, notes, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, name, normDomains(input.domains), input.type ?? 'client', input.stage_id ?? listStages()[0]?.id ?? null, input.owner_id ?? null,
    clean(input.next_action), checkDue(input.next_action_due), clean(input.notes), position
  )
  return getCompany(id)!
}

export function updateCompany(id: string, patch: Partial<CompanyInput>): void {
  const sets: string[] = []
  const params: unknown[] = []
  const set = (col: string, v: unknown) => (sets.push(`${col} = ?`), params.push(v))
  if (patch.name !== undefined) {
    if (!clean(patch.name)) throw new Error('Enter the company name')
    set('name', clean(patch.name))
  }
  if (patch.domains !== undefined) set('domains', normDomains(patch.domains))
  if (patch.type !== undefined) set('type', patch.type)
  if (patch.stage_id !== undefined) set('stage_id', patch.stage_id)
  if (patch.owner_id !== undefined) set('owner_id', patch.owner_id)
  if (patch.next_action !== undefined) set('next_action', clean(patch.next_action))
  if (patch.next_action_due !== undefined) set('next_action_due', checkDue(patch.next_action_due))
  if (patch.notes !== undefined) set('notes', clean(patch.notes))
  if (!sets.length) return
  run(`UPDATE companies SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...params, now(), id)
}

export function deleteCompany(id: string): void {
  run('DELETE FROM companies WHERE id = ?', id)
}

function checkEmails(email: unknown, others: unknown): { email: string; others: string[] } {
  const e = lower(email)
  if (e && !EMAIL.test(e)) throw new Error(`“${e}” is not a valid email address`)
  const o = [...new Set((Array.isArray(others) ? others : []).map(lower).filter(Boolean))]
  const bad = o.find((x) => !EMAIL.test(x))
  if (bad) throw new Error(`“${bad}” is not a valid email address`)
  return { email: e, others: o.filter((x) => x !== e) }
}

export function createPerson(input: PersonInput): Person {
  const name = clean(input.name)
  if (!name) throw new Error('Enter the person’s name')
  if (!get('SELECT 1 FROM companies WHERE id = ?', input.company_id)) throw new Error('Choose the company')
  const { email, others } = checkEmails(input.email, input.other_emails)
  const id = uuid()
  const position = (get<{ p: number | null }>('SELECT MAX(position) p FROM people WHERE company_id = ?', input.company_id)?.p ?? 0) + 1
  run(
    `INSERT INTO people (id, company_id, name, designation, phone, email, other_emails, action_owner, owner_id, next_action, next_action_due, notes, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, input.company_id, name, clean(input.designation), clean(input.phone), email, others, !!input.action_owner, input.owner_id ?? null,
    clean(input.next_action), checkDue(input.next_action_due), clean(input.notes), position
  )
  return listClients({}).flatMap((c) => c.people).find((p) => p.id === id)!
}

export function updatePerson(id: string, patch: Partial<PersonInput>): void {
  const cur = get<PersonRow>(`SELECT ${PERSON_COLS} FROM people WHERE id = ?`, id)
  if (!cur) throw new Error('Person not found')
  const sets: string[] = []
  const params: unknown[] = []
  const set = (col: string, v: unknown) => (sets.push(`${col} = ?`), params.push(v))
  if (patch.name !== undefined) {
    if (!clean(patch.name)) throw new Error('Enter the person’s name')
    set('name', clean(patch.name))
  }
  if (patch.company_id !== undefined) {
    if (!get('SELECT 1 FROM companies WHERE id = ?', patch.company_id)) throw new Error('Choose the company')
    set('company_id', patch.company_id)
  }
  if (patch.email !== undefined || patch.other_emails !== undefined) {
    const { email, others } = checkEmails(patch.email ?? cur.email, patch.other_emails ?? JSON.parse(cur.other_emails))
    set('email', email)
    set('other_emails', others)
  }
  for (const k of ['designation', 'phone', 'next_action', 'notes'] as const) if (patch[k] !== undefined) set(k, clean(patch[k]))
  if (patch.action_owner !== undefined) set('action_owner', !!patch.action_owner)
  if (patch.owner_id !== undefined) set('owner_id', patch.owner_id)
  if (patch.next_action_due !== undefined) set('next_action_due', checkDue(patch.next_action_due))
  if (!sets.length) return
  run(`UPDATE people SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...params, now(), id)
}

export function deletePerson(id: string): void {
  run('DELETE FROM people WHERE id = ?', id)
}

// ---------------------------------------------------------------- interactions

interface InteractionRow extends Omit<Interaction, 'person_ids' | 'member_ids'> {}

function loadInteractions(rows: InteractionRow[]): Interaction[] {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const ppl = all<{ interaction_id: string; person_id: string }>(`SELECT interaction_id, person_id FROM interaction_people WHERE interaction_id IN (${marks(ids.length)}) ORDER BY rowid`, ...ids)
  const mem = all<{ interaction_id: string; member_id: string }>(`SELECT interaction_id, member_id FROM interaction_members WHERE interaction_id IN (${marks(ids.length)}) ORDER BY rowid`, ...ids)
  return rows.map((r) => ({
    ...r,
    person_ids: ppl.filter((p) => p.interaction_id === r.id).map((p) => p.person_id),
    member_ids: mem.filter((m) => m.interaction_id === r.id).map((m) => m.member_id)
  }))
}

const INTERACTION_COLS = 'id, company_id, kind, channel, mode, title, at, duration_min, place, summary, next_steps, task_id'

function validateInteraction(i: Partial<InteractionInput>, companyId: string): void {
  if (!['call', 'chat', 'meeting', 'event', 'note'].includes(i.kind ?? '')) throw new Error('Choose what kind of contact it was')
  if (!isAppDate(i.at)) throw new Error('Choose when it happened')
  if (i.mode && !['in_person', 'office', 'virtual'].includes(i.mode)) throw new Error('Choose where the meeting was')
  if (i.duration_min !== null && i.duration_min !== undefined && !(i.duration_min >= 0 && i.duration_min <= 24 * 60)) throw new Error('Enter the duration in minutes')
  const people = i.person_ids ?? []
  if (people.length) {
    const ok = get<{ n: number }>(`SELECT COUNT(*) n FROM people WHERE company_id = ? AND id IN (${marks(people.length)})`, companyId, ...people)!.n
    if (ok !== new Set(people).size) throw new Error('Only people from this company can be part of it')
  }
}

function setParticipants(id: string, personIds: string[], memberIds: string[]): void {
  run('DELETE FROM interaction_people WHERE interaction_id = ?', id)
  run('DELETE FROM interaction_members WHERE interaction_id = ?', id)
  for (const p of new Set(personIds)) run('INSERT INTO interaction_people (interaction_id, person_id) VALUES (?, ?)', id, p)
  for (const m of new Set(memberIds)) run('INSERT OR IGNORE INTO interaction_members (interaction_id, member_id) SELECT ?, id FROM team_members WHERE id = ?', id, m)
}

export function logInteraction(input: InteractionInput): Interaction {
  if (!get('SELECT 1 FROM companies WHERE id = ?', input.company_id)) throw new Error('Choose the company')
  validateInteraction(input, input.company_id)
  return tx(() => {
    const id = uuid()
    let taskId: string | null = null
    if (input.task?.title?.trim()) {
      const t = createTask(
        { list_id: input.task.list_id, title: input.task.title.trim(), due_date: input.task.due_date ?? null, description: clean(input.next_steps) ? `<p>${escapeHtml(input.next_steps)}</p>` : '' },
        { source: 'manual' }
      )
      taskId = t.id
    }
    run(
      `INSERT INTO interactions (id, company_id, kind, channel, mode, title, at, duration_min, place, summary, next_steps, task_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, input.company_id, input.kind, clean(input.channel), input.kind === 'meeting' ? (input.mode ?? null) : null, clean(input.title), input.at,
      input.duration_min ?? null, clean(input.place), clean(input.summary), clean(input.next_steps), taskId
    )
    setParticipants(id, input.person_ids ?? [], input.member_ids ?? [])
    return loadInteractions(all<InteractionRow>(`SELECT ${INTERACTION_COLS} FROM interactions WHERE id = ?`, id))[0]
  })
}

export function updateInteraction(id: string, patch: Partial<InteractionInput>): void {
  const cur = loadInteractions(all<InteractionRow>(`SELECT ${INTERACTION_COLS} FROM interactions WHERE id = ?`, id))[0]
  if (!cur) throw new Error('Not found')
  const next = { ...cur, ...patch }
  validateInteraction(next, cur.company_id)
  tx(() => {
    run(
      'UPDATE interactions SET kind = ?, channel = ?, mode = ?, title = ?, at = ?, duration_min = ?, place = ?, summary = ?, next_steps = ?, updated_at = ? WHERE id = ?',
      next.kind, clean(next.channel), next.kind === 'meeting' ? (next.mode ?? null) : null, clean(next.title), next.at, next.duration_min ?? null, clean(next.place),
      clean(next.summary), clean(next.next_steps), now(), id
    )
    setParticipants(id, next.person_ids, next.member_ids)
  })
}

export function deleteInteraction(id: string): void {
  run('DELETE FROM interactions WHERE id = ?', id)
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Everything that happened with a company (or one person in it), newest first: interactions and emails. */
export function clientTimeline(companyId: string, personId?: string | null, limit = 200): TimelineItem[] {
  const people = all<{ id: string; email: string; other_emails: string }>('SELECT id, email, other_emails FROM people WHERE company_id = ?', companyId)
  const scope = personId ? people.filter((p) => p.id === personId) : people
  const addrOf = new Map<string, string>()
  for (const p of scope) for (const a of [p.email, ...(JSON.parse(p.other_emails) as string[])]) if (a) addrOf.set(a.toLowerCase(), p.id)
  const items: TimelineItem[] = []
  const ints = loadInteractions(
    personId
      ? all<InteractionRow>(`SELECT ${INTERACTION_COLS} FROM interactions WHERE company_id = ? AND id IN (SELECT interaction_id FROM interaction_people WHERE person_id = ?) ORDER BY at DESC LIMIT ?`, companyId, personId, limit)
      : all<InteractionRow>(`SELECT ${INTERACTION_COLS} FROM interactions WHERE company_id = ? ORDER BY at DESC LIMIT ?`, companyId, limit)
  )
  for (const i of ints) items.push({ type: 'interaction', at: i.at, interaction: i })
  const addrs = [...addrOf.keys()]
  if (addrs.length) {
    const rows = all<{ id: string; thread_id: string; subject: string; snippet: string; from_addr: string; to_addrs: string; cc_addrs: string; date: string; is_outbound: number }>(
      `SELECT id, thread_id, subject, snippet, from_addr, to_addrs, cc_addrs, date, is_outbound FROM mail_messages
       WHERE is_draft = 0 AND (from_addr IN (${marks(addrs.length)}) OR ${addrs.map(() => 'to_addrs LIKE ? OR cc_addrs LIKE ?').join(' OR ')})
       ORDER BY date DESC LIMIT ?`,
      ...addrs,
      ...addrs.flatMap((a) => [`%"${a}"%`, `%"${a}"%`]),
      limit
    )
    for (const r of rows) {
      const involved = new Set<string>()
      for (const a of [r.from_addr, ...[...(JSON.parse(r.to_addrs) as MailAddress[]), ...(JSON.parse(r.cc_addrs) as MailAddress[])].map((x) => x.address)]) {
        const pid = addrOf.get(a.toLowerCase())
        if (pid) involved.add(pid)
      }
      items.push({ type: 'email', at: r.date, thread_id: r.thread_id, message_id: r.id, subject: r.subject, snippet: r.snippet, from: r.from_addr, outbound: !!r.is_outbound, person_ids: [...involved] })
    }
  }
  // interaction times are local (YYYY-MM-DDTHH:mm), emails UTC: compare as instants
  const t = (x: TimelineItem) => (x.type === 'email' ? Date.parse(x.at) : new Date(x.at.length === 10 ? `${x.at}T12:00` : x.at).getTime())
  return items.sort((a, b) => t(b) - t(a)).slice(0, limit)
}

// ---------------------------------------------------------------- suggestions from email

/** "acme-corp.co.uk" → "Acme Corp" */
export function companyNameFromDomain(domain: string): string {
  const parts = domain.toLowerCase().split('.')
  const core = parts.length >= 3 && parts.at(-2)!.length <= 3 && parts.at(-1)!.length === 2 ? parts.at(-3)! : parts.length >= 2 ? parts.at(-2)! : parts[0]
  return core
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

/** People we've exchanged email with who aren't clients yet, grouped by company domain. */
export function clientSuggestions(limit = 40): ClientSuggestion[] {
  const ours = ourIdentity()
  const known = new Set<string>()
  for (const p of all<{ email: string; other_emails: string }>('SELECT email, other_emails FROM people')) for (const a of [p.email, ...(JSON.parse(p.other_emails) as string[])]) if (a) known.add(a)
  for (const r of all<{ address: string }>('SELECT address FROM crm_ignored')) known.add(r.address)
  // only real conversations: they wrote to us (not automated), or we wrote to them
  const counts = new Map<string, { name: string; messages: number; last: string }>()
  const bump = (address: string, name: string, date: string) => {
    const a = address.toLowerCase()
    if (!a || known.has(a) || isOurs(a, ours) || /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|info|support|newsletter)@/.test(a)) return
    const c = counts.get(a) ?? { name: '', messages: 0, last: '' }
    c.messages++
    if (name && !c.name) c.name = name
    if (date > c.last) c.last = date
    counts.set(a, c)
  }
  for (const m of all<{ from_addr: string; from_name: string; date: string }>("SELECT from_addr, from_name, date FROM mail_messages WHERE is_outbound = 0 AND is_auto = 0 AND is_draft = 0 AND date >= date('now', '-180 days')"))
    bump(m.from_addr, m.from_name, m.date)
  for (const m of all<{ to_addrs: string; cc_addrs: string; date: string }>("SELECT to_addrs, cc_addrs, date FROM mail_messages WHERE is_outbound = 1 AND is_draft = 0 AND date >= date('now', '-180 days')"))
    for (const x of [...(JSON.parse(m.to_addrs) as MailAddress[]), ...(JSON.parse(m.cc_addrs) as MailAddress[])]) bump(x.address, x.name, m.date)
  const companiesByDomain = new Map<string, string>()
  for (const c of all<{ id: string; domains: string }>('SELECT id, domains FROM companies')) for (const d of JSON.parse(c.domains) as string[]) companiesByDomain.set(d, c.id)
  const groups = new Map<string, ClientSuggestion>()
  for (const [address, c] of counts) {
    const domain = address.split('@')[1] ?? ''
    const free = isFreeMailDomain(domain)
    const key = free ? address : domain
    const g = groups.get(key) ?? { key, company_guess: free ? c.name || address.split('@')[0] : companyNameFromDomain(domain), company_id: free ? null : (companiesByDomain.get(domain) ?? null), people: [] }
    g.people.push({ address, name: c.name, messages: c.messages, last: c.last })
    groups.set(key, g)
  }
  return [...groups.values()]
    .map((g) => ({ ...g, people: g.people.sort((a, b) => b.messages - a.messages) }))
    .sort((a, b) => b.people.reduce((n, p) => n + p.messages, 0) - a.people.reduce((n, p) => n + p.messages, 0))
    .slice(0, limit)
}

/** Add suggested people: to an existing company, or to a new one named `companyName`. */
export function addSuggestion(input: { people: { address: string; name: string }[]; company_id?: string | null; company_name?: string; domain?: string | null }): Company {
  return tx(() => {
    let companyId = input.company_id ?? null
    if (!companyId) {
      const domain = input.domain && !isFreeMailDomain(input.domain) ? [input.domain] : []
      companyId = createCompany({ name: clean(input.company_name) || 'New company', domains: domain }).id
    }
    for (const p of input.people) {
      const addr = lower(p.address)
      if (get('SELECT 1 FROM people WHERE email = ?', addr)) continue
      createPerson({ company_id: companyId, name: clean(p.name) || addr.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), email: addr })
    }
    return getCompany(companyId)!
  })
}

export function ignoreSuggestion(addresses: string[]): void {
  tx(() => {
    for (const a of addresses) run('INSERT OR IGNORE INTO crm_ignored (address, created_at) VALUES (?, ?)', lower(a), now())
  })
}
