import type { EmailTemplate, MailAddress } from '@shared/mail'
import { all, get, now, run, uuid } from '../../db'

// ---------------------------------------------------------------- email templates

export function listTemplates(): EmailTemplate[] {
  return all<EmailTemplate>('SELECT id, name, subject, body FROM email_templates ORDER BY name COLLATE NOCASE')
}

export function saveTemplate(input: Partial<EmailTemplate> & { name: string }): EmailTemplate {
  if (!input.name.trim()) throw new Error('Give the template a name')
  if (input.id) {
    run('UPDATE email_templates SET name = ?, subject = ?, body = ?, updated_at = ? WHERE id = ?', input.name, input.subject ?? '', input.body ?? '', now(), input.id)
    return get<EmailTemplate>('SELECT id, name, subject, body FROM email_templates WHERE id = ?', input.id)!
  }
  const id = uuid()
  run('INSERT INTO email_templates (id, name, subject, body) VALUES (?, ?, ?, ?)', id, input.name, input.subject ?? '', input.body ?? '')
  return { id, name: input.name, subject: input.subject ?? '', body: input.body ?? '' }
}

export function deleteTemplate(id: string): void {
  run('DELETE FROM email_templates WHERE id = ?', id)
}

/** {{first_name}}, {{name}}, {{subject}} for a recipient. */
export function personalize(text: string, to: MailAddress | null, subject: string): string {
  const local = to?.address.split('@')[0] ?? ''
  const name = to?.name || local.replace(/[._-]+/g, ' ')
  const first = (name.split(/\s+/)[0] ?? '').replace(/^\w/, (c) => c.toUpperCase())
  return text.replace(/\{\{\s*first_name\s*\}\}/g, first || 'there').replace(/\{\{\s*name\s*\}\}/g, name || 'there').replace(/\{\{\s*subject\s*\}\}/g, subject)
}

/** "Ana Lima <ana@x.com>" → { name: "Ana Lima", address: "ana@x.com" } */
export function parseAddress(text: string): MailAddress {
  const t = text.trim()
  const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(t)
  if (m) return { name: m[1].replace(/^"|"$/g, '').trim(), address: m[2].trim().toLowerCase() }
  return { name: '', address: t.toLowerCase() }
}
