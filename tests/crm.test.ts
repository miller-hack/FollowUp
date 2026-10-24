import { beforeEach, describe, expect, it } from 'vitest'
import { closeDb, openDb } from '../src/main/db'
import * as h from '../src/main/services/hierarchy'
import * as t from '../src/main/services/tasks'
import * as crm from '../src/main/services/crm'
import * as io from '../src/main/services/crmio'
import * as accounts from '../src/main/services/mail/accounts'
import * as store from '../src/main/services/mail/store'

const ME = 'me@talent.example'

beforeEach(() => {
  closeDb()
  openDb(':memory:')
})

function mailbox() {
  const acc = accounts.createAccount({
    kind: 'mail', name: 'Syed', email: ME, password: 'pw',
    config: { imap: { host: 'h', port: 993, secure: true, user: ME }, smtp: { host: 'h', port: 465, secure: true, user: ME }, syncDays: 30, appendSent: false }
  })
  const mail = async (raw: string[]) => {
    const p = await store.parseRaw(Buffer.from([...raw, 'Content-Type: text/plain', '', 'Hi'].join('\r\n')))
    return store.storeMessage(acc.id, p, { accountEmail: ME, folder: 'INBOX', uid: Math.floor(Math.random() * 1e6), seen: true, inInbox: true })
  }
  return { acc, mail }
}

describe('companies and people', () => {
  it('keeps the table tidy: names, domains, emails and stages are checked', () => {
    expect(() => crm.createCompany({ name: '  ' })).toThrow(/company name/)
    expect(() => crm.createCompany({ name: 'Acme', domains: ['not a domain'] })).toThrow(/not a domain/)
    const acme = crm.createCompany({ name: 'Acme', domains: ['@Acme.com', 'www.acme.co.uk'] })
    expect(acme).toMatchObject({ domains: ['acme.com', 'acme.co.uk'], stage_id: 'stage-lead', type: 'client' })
    expect(() => crm.createPerson({ company_id: acme.id, name: 'Ana', email: 'ana at acme' })).toThrow(/not a valid email/)
    const ana = crm.createPerson({ company_id: acme.id, name: 'Ana Lima', designation: 'Buyer', phone: '+92 300 1234567', email: 'Ana@Acme.com', action_owner: true })
    crm.createPerson({ company_id: acme.id, name: 'Bob', email: 'bob@acme.com' })
    const [c] = crm.listClients()
    expect(c.people.map((p) => p.name)).toEqual(['Ana Lima', 'Bob'])
    expect(c.people[0]).toMatchObject({ email: 'ana@acme.com', action_owner: true, responds: false, last_contact: null })
    crm.updateCompany(acme.id, { stage_id: 'stage-proposal', next_action: 'Send revised quote', next_action_due: '2026-11-02' })
    expect(() => crm.updateCompany(acme.id, { next_action_due: 'Friday' })).toThrow(/valid date/)
    expect(crm.listClients({ stage_id: 'stage-proposal' })).toHaveLength(1)
    expect(crm.listClients({ search: 'buyer' })).toHaveLength(1)
    expect(crm.listClients({ search: '300 123' })).toHaveLength(1)
    crm.deleteCompany(acme.id)
    expect(crm.listClients()).toHaveLength(0)
    void ana
  })

  it('stages can be renamed, reordered, added and removed', () => {
    const acme = crm.createCompany({ name: 'Acme', stage_id: 'stage-hold' })
    const stages = crm.listStages().filter((s) => s.id !== 'stage-hold')
    const next = crm.saveStages([{ id: '', name: 'Exhibition contact', color: '#0ea5e9', kind: 'open' }, ...stages])
    expect(next[0].name).toBe('Exhibition contact')
    expect(next.map((s) => s.id)).not.toContain('stage-hold')
    expect(crm.listClients()[0].stage_id).toBeNull() // the company's stage was removed
    expect(() => crm.saveStages([])).toThrow(/at least one/)
    void acme
  })

  it('starts the team with the user and adds teammates', () => {
    const { acc } = mailbox()
    expect(crm.listTeam()).toMatchObject([{ name: 'Syed', email: ME }])
    crm.saveTeamMember({ name: 'Hina', email: 'hina@talent.example' })
    expect(crm.listTeam().map((m) => m.name)).toEqual(['Syed', 'Hina'])
    expect(() => crm.saveTeamMember({ name: 'X', email: 'nope' })).toThrow(/valid email/)
    void acc
  })
})

describe('history', () => {
  it('logs who took part in a meeting and merges it with their emails', async () => {
    const { mail } = mailbox()
    const list = h.createList({ space_id: h.createSpace({ name: 'Work' }).id, name: 'Sales' })
    const acme = crm.createCompany({ name: 'Acme', domains: ['acme.com'] })
    const ana = crm.createPerson({ company_id: acme.id, name: 'Ana', email: 'ana@acme.com' })
    const bob = crm.createPerson({ company_id: acme.id, name: 'Bob', email: 'bob@acme.com' })
    const carl = crm.createPerson({ company_id: acme.id, name: 'Carl' })
    const other = crm.createPerson({ company_id: crm.createCompany({ name: 'Other' }).id, name: 'Zed' })
    const hina = crm.saveTeamMember({ name: 'Hina' })

    await mail([`From: Ana <ana@acme.com>`, `To: ${ME}`, 'Subject: Pricing', 'Message-ID: <a1@acme.com>', `Date: ${new Date(Date.now() - 2 * 86_400_000).toUTCString()}`])
    await mail([`From: Syed <${ME}>`, 'To: Bob <bob@acme.com>', 'Cc: ana@acme.com', 'Subject: Agenda', 'Message-ID: <s1@talent.example>', `Date: ${new Date(Date.now() - 86_400_000).toUTCString()}`])

    expect(() => crm.logInteraction({ company_id: acme.id, kind: 'meeting', channel: '', mode: 'virtual', title: 'x', at: '2026-10-20T10:00', duration_min: 30, place: '', summary: '', next_steps: '', person_ids: [other.id], member_ids: [] })).toThrow(/Only people from this company/)
    const meeting = crm.logInteraction({
      company_id: acme.id, kind: 'meeting', channel: 'Zoom', mode: 'virtual', title: 'Kick-off', at: '2026-10-20T10:00', duration_min: 45,
      place: 'https://zoom.example/j/1', summary: 'Agreed on scope', next_steps: 'Send the contract', person_ids: [ana.id, bob.id], member_ids: [hina.id],
      task: { list_id: list.id, title: 'Send Acme the contract', due_date: '2026-10-27' }
    })
    expect(meeting).toMatchObject({ mode: 'virtual', person_ids: [ana.id, bob.id], member_ids: [hina.id] })
    expect(t.getTask(meeting.task_id!)).toMatchObject({ title: 'Send Acme the contract', due_date: '2026-10-27' })
    crm.logInteraction({ company_id: acme.id, kind: 'call', channel: 'Phone', mode: null, title: '', at: '2026-10-21T15:00', duration_min: 10, place: '', summary: 'Carl confirmed budget', next_steps: '', person_ids: [carl.id], member_ids: [] })

    const people = crm.listClients()[0].people
    const by = (n: string) => people.find((p) => p.name === n)!
    expect(by('Ana')).toMatchObject({ responds: true, emails_in: 1, emails_out: 1, interactions: 1 })
    expect(by('Bob')).toMatchObject({ responds: false, emails_in: 0, emails_out: 1, interactions: 1 })
    expect(by('Carl')).toMatchObject({ interactions: 1, last_contact: '2026-10-21T15:00' })

    // the company: everything; a person: only what they were part of
    const all = crm.clientTimeline(acme.id)
    expect(all.map((x) => (x.type === 'email' ? x.subject : x.interaction.title || x.interaction.kind))).toEqual(['Agenda', 'Pricing', 'call', 'Kick-off'])
    const carls = crm.clientTimeline(acme.id, carl.id)
    expect(carls.map((x) => x.type)).toEqual(['interaction'])
    const anas = crm.clientTimeline(acme.id, ana.id)
    expect(anas.filter((x) => x.type === 'email')).toHaveLength(2)
    expect(anas.filter((x) => x.type === 'interaction')).toHaveLength(1)

    // the inbox shows the company on Ana's thread
    const thread = store.listThreads({ folder: 'all' }).find((x) => x.subject === 'Pricing')!
    expect(thread.company).toMatchObject({ name: 'Acme', stage: 'Lead' })
  })
})

describe('suggestions from email', () => {
  it('groups people by company domain, keeps public mailboxes apart and skips robots and ourselves', async () => {
    const { mail } = mailbox()
    const d = new Date().toUTCString()
    await mail(['From: Ana <ana@acme-corp.co.uk>', `To: ${ME}`, 'Subject: a', 'Message-ID: <1@x>', `Date: ${d}`])
    await mail(['From: Bob Stone <bob@acme-corp.co.uk>', `To: ${ME}`, 'Subject: b', 'Message-ID: <2@x>', `Date: ${d}`])
    await mail(['From: Kim <kim.lee@gmail.com>', `To: ${ME}`, 'Subject: c', 'Message-ID: <3@x>', `Date: ${d}`])
    await mail(['From: noreply@shop.example', `To: ${ME}`, 'Subject: d', 'Message-ID: <4@x>', `Date: ${d}`])
    await mail(['From: Hina <hina@talent.example>', `To: ${ME}`, 'Subject: e', 'Message-ID: <5@x>', `Date: ${d}`])
    await mail(['From: List <news@deals.example>', `To: ${ME}`, 'List-Id: <deals>', 'Subject: f', 'Message-ID: <6@x>', `Date: ${d}`])
    const s = crm.clientSuggestions()
    expect(s.map((g) => [g.key, g.company_guess, g.people.length])).toEqual([
      ['acme-corp.co.uk', 'Acme Corp', 2],
      ['kim.lee@gmail.com', 'Kim', 1]
    ])
    const company = crm.addSuggestion({ people: s[0].people, company_name: 'ACME Corporation', domain: 'acme-corp.co.uk' })
    expect(company.people.map((p) => p.name)).toEqual(['Ana', 'Bob Stone'])
    expect(company.domains).toEqual(['acme-corp.co.uk'])
    crm.ignoreSuggestion(['kim.lee@gmail.com'])
    expect(crm.clientSuggestions()).toEqual([])
  })

  it('guesses company names from domains', () => {
    expect(crm.companyNameFromDomain('thetalentunlimited.com')).toBe('Thetalentunlimited')
    expect(crm.companyNameFromDomain('acme-corp.co.uk')).toBe('Acme Corp')
    expect(crm.companyNameFromDomain('cloud.neduet.edu.pk')).toBe('Neduet')
  })
})

describe('import and export', () => {
  it('imports a CSV with a column mapping, without duplicating people', async () => {
    const csv = '﻿Organisation,Contact,Job Title,Mobile,E-mail,Stage\r\nAcme,Ana Lima,Buyer,0300 1111111,ana@acme.com,Proposal sent\r\nAcme,"Stone, Bob",CEO,,bob@acme.com,\r\nGlobex,Kim,,,kim@globex.com,Lead\r\n,,,,,\r\n'
    const p = await io.previewImport('clients.csv', Buffer.from(csv))
    expect(p.headers).toEqual(['Organisation', 'Contact', 'Job Title', 'Mobile', 'E-mail', 'Stage'])
    expect(p.mapping).toEqual({ company: 0, name: 1, designation: 2, phone: 3, email: 4, stage: 5 })
    expect(p.total).toBe(3)
    expect(io.runImport(p.token, p.mapping)).toEqual({ companies: 2, people: 3, updated: 0, skipped: 0 })
    const clients = crm.listClients()
    expect(clients.map((c) => [c.name, c.stage_id, c.people.map((x) => x.name)])).toEqual([
      ['Acme', 'stage-proposal', ['Ana Lima', 'Stone, Bob']],
      ['Globex', 'stage-lead', ['Kim']]
    ])
    // importing again updates instead of duplicating
    const again = await io.previewImport('clients.csv', Buffer.from(csv))
    expect(io.runImport(again.token, again.mapping)).toMatchObject({ companies: 0, people: 0, updated: 3 })
  })

  it('exports to Excel and the file imports back', async () => {
    const acme = crm.createCompany({ name: 'Acme', domains: ['acme.com'] })
    crm.createPerson({ company_id: acme.id, name: 'Ana', designation: 'Buyer', email: 'ana@acme.com', phone: '+1 555' })
    crm.logInteraction({ company_id: acme.id, kind: 'event', channel: '', mode: null, title: 'Expo 2026', at: '2026-10-10', duration_min: null, place: 'Karachi Expo Centre', summary: 'Met at our stand', next_steps: '', person_ids: [], member_ids: [] })
    const xlsx = await io.exportClientsXlsx()
    expect(xlsx.subarray(0, 2).toString()).toBe('PK') // a zip file
    const rows = await io.readRows('export.xlsx', xlsx)
    expect(rows[0].slice(0, 9)).toEqual(['Company', 'Type', 'Stage', 'Company owner', 'Domains', 'Name', 'Designation', 'Phone', 'Work email'])
    expect(rows[1].slice(0, 9)).toEqual(['Acme', 'client', 'Lead', '', 'acme.com', 'Ana', 'Buyer', '+1 555', 'ana@acme.com'])
    expect(io.exportClientsCsv()).toMatch(/^﻿Company,Type,Stage/)
    crm.deleteCompany(acme.id)
    const back = await io.previewImport('export.xlsx', xlsx)
    expect(back.mapping).toMatchObject({ company: 0, stage: 2, name: 5, designation: 6, phone: 7, email: 8 })
    io.runImport(back.token, back.mapping)
    expect(crm.listClients()[0]).toMatchObject({ name: 'Acme', domains: [], people: [{ name: 'Ana', email: 'ana@acme.com', phone: '+1 555' }] })
  })

  it('parses tricky CSV', () => {
    expect(io.parseCsv('a;b\n"x;1";"y ""q"""\n')).toEqual([['a', 'b'], ['x;1', 'y "q"']])
    expect(io.parseCsv('a,b\r\n"multi\nline",2')).toEqual([['a', 'b'], ['multi\nline', '2']])
  })
})
