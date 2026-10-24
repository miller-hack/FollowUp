/** Clients (ADR-016): companies, their people, the relationship stage and everything that happened. */

export type StageKind = 'open' | 'won' | 'lost' | 'hold'

export interface CrmStage {
  id: string
  name: string
  color: string
  kind: StageKind
  position: number
}

export interface TeamMember {
  id: string
  name: string
  email: string
  position: number
}

export type CompanyType = 'client' | 'vendor' | 'partner' | 'other'

export interface Person {
  id: string
  company_id: string
  name: string
  designation: string
  phone: string
  /** work email */
  email: string
  other_emails: string[]
  /** responsible for acting on their side */
  action_owner: boolean
  /** on our side */
  owner_id: string | null
  next_action: string
  next_action_due: string | null
  notes: string
  position: number
  /** latest email from or to them, or interaction with them */
  last_contact: string | null
  /** they wrote to us in the last 90 days */
  responds: boolean
  /** emails from them / to them */
  emails_in: number
  emails_out: number
  interactions: number
}

export interface Company {
  id: string
  name: string
  /** email domains that belong to the company, e.g. ["acme.com"] */
  domains: string[]
  type: CompanyType
  stage_id: string | null
  owner_id: string | null
  next_action: string
  next_action_due: string | null
  notes: string
  position: number
  people: Person[]
  last_contact: string | null
}

export type CompanyInput = Partial<Omit<Company, 'id' | 'people' | 'last_contact' | 'position'>> & { name: string }
export type PersonInput = Partial<Omit<Person, 'id' | 'last_contact' | 'responds' | 'emails_in' | 'emails_out' | 'interactions' | 'position'>> & {
  company_id: string
  name: string
}

export type InteractionKind = 'call' | 'chat' | 'meeting' | 'event' | 'note'
export type MeetingMode = 'in_person' | 'office' | 'virtual'

export const INTERACTION_LABEL: Record<InteractionKind, string> = {
  call: 'Phone call',
  chat: 'Chat / WhatsApp',
  meeting: 'Meeting',
  event: 'Exhibition / event',
  note: 'Note'
}

export const MEETING_MODE_LABEL: Record<MeetingMode, string> = { in_person: 'In person', office: 'At their office', virtual: 'Online' }

export interface Interaction {
  id: string
  company_id: string
  kind: InteractionKind
  /** e.g. WhatsApp, phone, Teams, Zoom */
  channel: string
  mode: MeetingMode | null
  title: string
  /** local date-time YYYY-MM-DDTHH:mm */
  at: string
  duration_min: number | null
  /** address, room or meeting link */
  place: string
  summary: string
  next_steps: string
  person_ids: string[]
  member_ids: string[]
  task_id: string | null
}

export type InteractionInput = Omit<Interaction, 'id' | 'task_id'> & {
  /** also create a task (with the next steps) in this list */
  task?: { list_id: string; title: string; due_date: string | null } | null
}

/** One line in a company's or person's history: a logged interaction or an email. */
export type TimelineItem =
  | { type: 'interaction'; at: string; interaction: Interaction }
  | { type: 'email'; at: string; thread_id: string; message_id: string; subject: string; snippet: string; from: string; outbound: boolean; person_ids: string[] }

export interface ClientFilter {
  search?: string
  stage_id?: string | null
  owner_id?: string | null
  type?: CompanyType | null
}

/** People found in email who aren't clients yet. */
export interface ClientSuggestion {
  /** the company domain, or the address itself for public mailboxes (gmail.com, …) */
  key: string
  company_guess: string
  /** an existing company with this domain, if any */
  company_id: string | null
  people: { address: string; name: string; messages: number; last: string }[]
}

export interface ImportPreview {
  token: string
  file_name: string
  headers: string[]
  rows: string[][]
  total: number
  /** best guess of which column holds what */
  mapping: ImportMapping
}

export type ImportField = 'company' | 'name' | 'designation' | 'phone' | 'email' | 'stage' | 'notes' | 'domain'
export type ImportMapping = Partial<Record<ImportField, number>>
