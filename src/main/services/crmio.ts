import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { readSheet } from 'read-excel-file/node'
import writeXlsxFile from 'write-excel-file/node'
import type { ImportField, ImportMapping, ImportPreview } from '@shared/crm'
import { INTERACTION_LABEL, MEETING_MODE_LABEL } from '@shared/crm'
import { all, get, tx, uuid } from '../db'
import { clientTimeline, createCompany, createPerson, listClients, listStages, listTeam, updatePerson } from './crm'

/** Clients ⇄ spreadsheets (ADR-016): import .xlsx / .csv with a column mapping, export .xlsx or .csv. */

const MAX_ROWS = 5000

// ---------------------------------------------------------------- reading

/** RFC 4180 CSV (quoted fields, "" escapes, CRLF/LF), also ; or tab separated. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const sep = [',', ';', '\t'].map((s) => [s, firstLine.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0]
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') (field += '"'), i++
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === sep) row.push(field), (field = '')
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) row.push(field), rows.push(row)
  return rows.filter((r) => r.some((x) => x.trim() !== ''))
}

const cellText = (v: unknown): string => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim()

export async function readRows(file: string, content?: Buffer): Promise<string[][]> {
  const buf = content ?? readFileSync(file)
  const ext = extname(file).toLowerCase()
  if (ext === '.csv' || ext === '.txt') return parseCsv(buf.toString('utf8'))
  if (ext === '.xlsx') return ((await readSheet(buf)) as unknown[][]).map((r) => r.map(cellText)).filter((r) => r.some(Boolean))
  throw new Error('Choose an Excel (.xlsx) or CSV file')
}

// ---------------------------------------------------------------- mapping

const GUESS: [ImportField, RegExp][] = [
  ['company', /^(company|organi[sz]ation|organisation name|company name|account|firm|client|employer)$/i],
  ['name', /^(name|full name|contact|contact name|person)$/i],
  ['designation', /^(designation|title|job title|position|role)$/i],
  ['phone', /^(phone|mobile|cell|telephone|tel|phone number|mobile number|whatsapp)$/i],
  ['email', /^(e-?mail|work e-?mail|email address|e-?mail address)$/i],
  ['stage', /^(stage|status|pipeline stage)$/i],
  ['notes', /^(notes?|comments?|remarks?)$/i],
  ['domain', /^(domain|website|web|url)$/i]
]

export function guessMapping(headers: string[]): ImportMapping {
  const m: ImportMapping = {}
  headers.forEach((h, i) => {
    const hit = GUESS.find(([f, re]) => m[f] === undefined && re.test(h.trim()))
    if (hit) m[hit[0]] = i
  })
  return m
}

const previews = new Map<string, { file: string; rows: string[][] }>()

export async function previewImport(file: string, content?: Buffer): Promise<ImportPreview> {
  const rows = await readRows(file, content)
  if (rows.length < 2) throw new Error('The file has no rows under its header row')
  if (rows.length - 1 > MAX_ROWS) throw new Error(`The file has more than ${MAX_ROWS} rows; split it into smaller files`)
  const token = uuid()
  previews.set(token, { file, rows })
  const headers = rows[0]
  return { token, file_name: basename(file), headers, rows: rows.slice(1, 8), total: rows.length - 1, mapping: guessMapping(headers) }
}

/** Create companies and people from a previewed file. Existing people (same email) are updated, never duplicated. */
export function runImport(token: string, mapping: ImportMapping): { companies: number; people: number; updated: number; skipped: number } {
  const p = previews.get(token)
  if (!p) throw new Error('Open the file again')
  if (mapping.company === undefined && mapping.name === undefined) throw new Error('Choose at least the company or the name column')
  const col = (r: string[], f: ImportField) => (mapping[f] === undefined ? '' : (r[mapping[f]!] ?? '').trim())
  const stages = new Map(listStages().map((s) => [s.name.toLowerCase(), s.id]))
  const result = { companies: 0, people: 0, updated: 0, skipped: 0 }
  tx(() => {
    const byName = new Map(all<{ id: string; name: string }>('SELECT id, name FROM companies').map((c) => [c.name.toLowerCase(), c.id]))
    for (const r of p.rows.slice(1)) {
      const name = col(r, 'name')
      const email = col(r, 'email').toLowerCase()
      const domainCell = col(r, 'domain').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
      let company = col(r, 'company')
      if (!company && !name) {
        result.skipped++
        continue
      }
      if (!company) company = email.includes('@') ? email.split('@')[1] : name
      let companyId = byName.get(company.toLowerCase())
      if (!companyId) {
        const domains = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domainCell) ? [domainCell] : []
        companyId = createCompany({ name: company, domains, stage_id: stages.get(col(r, 'stage').toLowerCase()) ?? undefined }).id
        byName.set(company.toLowerCase(), companyId)
        result.companies++
      }
      if (!name) continue
      const existing = email ? get<{ id: string }>('SELECT id FROM people WHERE email = ?', email) : undefined
      try {
        const fields = { designation: col(r, 'designation'), phone: col(r, 'phone'), notes: col(r, 'notes') }
        if (existing) {
          updatePerson(existing.id, Object.fromEntries(Object.entries(fields).filter(([, v]) => v)))
          result.updated++
        } else {
          createPerson({ company_id: companyId, name, email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '', ...fields })
          result.people++
        }
      } catch {
        result.skipped++
      }
    }
  })
  previews.delete(token)
  return result
}

// ---------------------------------------------------------------- writing

const head = (titles: string[]) => titles.map((value) => ({ value, fontWeight: 'bold' as const }))

/** Two sheets: one row per person (company details repeated), and every logged interaction. */
export async function exportClientsXlsx(): Promise<Buffer> {
  const { clientRows, interactionRows } = exportRows()
  return writeXlsxFile([
    { sheet: 'Clients', data: [head(CLIENT_COLUMNS), ...clientRows], columns: CLIENT_COLUMNS.map((c) => ({ width: Math.max(12, c.length + 4) })), stickyRowsCount: 1 },
    { sheet: 'Interactions', data: [head(INTERACTION_COLUMNS), ...interactionRows], columns: INTERACTION_COLUMNS.map(() => ({ width: 22 })), stickyRowsCount: 1 }
  ]).toBuffer()
}

export function exportClientsCsv(): string {
  const { clientRows } = exportRows()
  const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return '﻿' + [CLIENT_COLUMNS, ...clientRows].map((r) => r.map((v) => esc(String(v))).join(',')).join('\r\n') + '\r\n'
}

const CLIENT_COLUMNS = ['Company', 'Type', 'Stage', 'Company owner', 'Domains', 'Name', 'Designation', 'Phone', 'Work email', 'Other emails', 'Responsible on their side', 'Our owner', 'Last contact', 'Next action', 'Next action due', 'Notes']
const INTERACTION_COLUMNS = ['Date', 'Company', 'Kind', 'Where', 'Title', 'Their people', 'Our team', 'Duration (min)', 'Summary', 'Next steps']

function exportRows(): { clientRows: string[][]; interactionRows: string[][] } {
  const stages = new Map(listStages().map((s) => [s.id, s.name]))
  const team = new Map(listTeam().map((m) => [m.id, m.name]))
  const clientRows: string[][] = []
  const interactionRows: string[][] = []
  for (const c of listClients({})) {
    const companyCells = [c.name, c.type, c.stage_id ? (stages.get(c.stage_id) ?? '') : '', c.owner_id ? (team.get(c.owner_id) ?? '') : '', c.domains.join(' ')]
    if (!c.people.length) clientRows.push([...companyCells, '', '', '', '', '', '', '', c.last_contact?.slice(0, 10) ?? '', c.next_action, c.next_action_due ?? '', c.notes])
    for (const p of c.people)
      clientRows.push([
        ...companyCells,
        p.name,
        p.designation,
        p.phone,
        p.email,
        p.other_emails.join(' '),
        p.action_owner ? 'yes' : '',
        p.owner_id ? (team.get(p.owner_id) ?? '') : '',
        p.last_contact?.slice(0, 10) ?? '',
        p.next_action || c.next_action,
        p.next_action_due ?? c.next_action_due ?? '',
        p.notes
      ])
    const names = new Map(c.people.map((p) => [p.id, p.name]))
    for (const t of clientTimeline(c.id, null, 10_000)) {
      if (t.type !== 'interaction') continue
      const i = t.interaction
      interactionRows.push([
        i.at.replace('T', ' '),
        c.name,
        INTERACTION_LABEL[i.kind],
        [i.mode ? MEETING_MODE_LABEL[i.mode] : '', i.channel, i.place].filter(Boolean).join(' · '),
        i.title,
        i.person_ids.map((id) => names.get(id) ?? '').filter(Boolean).join(', '),
        i.member_ids.map((id) => team.get(id) ?? '').filter(Boolean).join(', '),
        i.duration_min === null ? '' : String(i.duration_min),
        i.summary,
        i.next_steps
      ])
    }
  }
  return { clientRows, interactionRows }
}
