import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import type { FieldOption, FieldType, Space, StatusInput, StatusType } from '@shared/types'
import { api } from '@/lib/api'
import { useFields, useTreeMaps } from '@/lib/hooks'
import { PALETTE } from '@/lib/utils'
import { Button, ColorGrid, IconButton, Input, Modal, Popover } from '@/components/ui'

const TYPE_LABEL: Record<StatusType, string> = { open: 'Not started', active: 'Active', done: 'Done' }

export function StatusEditor({ space, onClose }: { space: Space; onClose: () => void }) {
  const maps = useTreeMaps()
  const [rows, setRows] = useState<StatusInput[]>(() =>
    (maps?.statusesOf(space.id) ?? []).map(({ id, name, color, type }) => ({ id, name, color, type }))
  )
  const patch = (i: number, p: Partial<StatusInput>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)))
  const move = (i: number, d: -1 | 1) => {
    const next = [...rows]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    setRows(next)
  }
  const valid = rows.length > 0 && rows.every((r) => r.name.trim()) && rows.some((r) => r.type === 'done')
  return (
    <Modal
      title={`Statuses · ${space.name}`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={async () => (await api.saveStatuses(space.id, rows), onClose())}>
            Save
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-muted">
        Tasks in a removed status move to another status of the same kind. At least one “Done” status is required.
      </p>
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={r.id ?? i} className="flex items-center gap-2">
            <Popover trigger={<button type="button" className="h-5 w-5 rounded-full" style={{ background: r.color }} aria-label="Color" />}>
              {(close) => <ColorGrid value={r.color} onChange={(color) => (patch(i, { color }), close())} />}
            </Popover>
            <Input value={r.name} onChange={(e) => patch(i, { name: e.target.value })} className="flex-1" />
            <select
              value={r.type}
              onChange={(e) => patch(i, { type: e.target.value as StatusType })}
              className="h-8 rounded-md border border-line bg-panel px-2 text-[13px]"
            >
              {Object.entries(TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <IconButton label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></IconButton>
            <IconButton label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></IconButton>
            <IconButton label="Remove" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={14} /></IconButton>
          </div>
        ))}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="mt-3"
        onClick={() => setRows([...rows, { name: 'New status', color: PALETTE[rows.length % PALETTE.length], type: 'active' }])}
      >
        <Plus size={13} /> Add status
      </Button>
    </Modal>
  )
}

const FIELD_TYPES: [FieldType, string][] = [
  ['text', 'Text'],
  ['number', 'Number'],
  ['money', 'Money'],
  ['date', 'Date'],
  ['dropdown', 'Dropdown'],
  ['labels', 'Labels (multi)'],
  ['checkbox', 'Checkbox'],
  ['url', 'Website'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['rating', 'Rating'],
  ['progress', 'Progress %']
]

function OptionsEditor({ options, onChange }: { options: FieldOption[]; onChange: (o: FieldOption[]) => void }) {
  const [text, setText] = useState('')
  const add = () => {
    if (!text.trim()) return
    onChange([...options, { id: crypto.randomUUID(), label: text.trim(), color: PALETTE[options.length % PALETTE.length] }])
    setText('')
  }
  return (
    <div className="mt-2 space-y-1 pl-2">
      {options.map((o, i) => (
        <div key={o.id} className="flex items-center gap-2">
          <Popover trigger={<button type="button" className="h-4 w-4 rounded-full" style={{ background: o.color }} aria-label="Option color" />}>
            {(close) => <ColorGrid value={o.color} onChange={(color) => (onChange(options.map((x, j) => (j === i ? { ...x, color } : x))), close())} />}
          </Popover>
          <span className="flex-1">{o.label}</span>
          <IconButton label="Remove option" onClick={() => onChange(options.filter((_, j) => j !== i))}><Trash2 size={13} /></IconButton>
        </div>
      ))}
      <div className="flex gap-2">
        <Input value={text} placeholder="New option" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} className="h-7" />
        <Button size="sm" onClick={add}>Add</Button>
      </div>
    </div>
  )
}

export function FieldManager({ space, onClose }: { space: Space; onClose: () => void }) {
  const { data: fields = [] } = useFields(space.id)
  const [name, setName] = useState('')
  const [type, setType] = useState<FieldType>('text')
  const create = async () => {
    if (!name.trim()) return
    await api.createField({ space_id: space.id, name, type })
    setName('')
  }
  return (
    <Modal title={`Custom fields · ${space.name}`} onClose={onClose} width={560}>
      <p className="mb-3 text-xs text-muted">Fields apply to every list in this space and appear as columns in List view.</p>
      <div className="space-y-2">
        {fields.map((f) => (
          <div key={f.id} className="rounded-lg border border-line p-2.5">
            <div className="flex items-center gap-2">
              <input
                defaultValue={f.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== f.name && api.updateField(f.id, { name: e.target.value.trim() })}
                className="flex-1 bg-transparent font-medium outline-none"
              />
              <span className="text-xs text-muted">{FIELD_TYPES.find(([t]) => t === f.type)?.[1]}</span>
              <IconButton
                label="Delete field"
                onClick={() => window.confirm(`Delete field “${f.name}” and all its values?`) && api.deleteField(f.id)}
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
            {(f.type === 'dropdown' || f.type === 'labels') && (
              <OptionsEditor options={f.options} onChange={(options) => api.updateField(f.id, { options })} />
            )}
          </div>
        ))}
        {fields.length === 0 && <p className="text-muted">No custom fields yet.</p>}
      </div>
      <div className="mt-4 flex gap-2 border-t border-line pt-4">
        <Input placeholder="Field name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <select value={type} onChange={(e) => setType(e.target.value as FieldType)} className="h-8 rounded-md border border-line bg-panel px-2 text-[13px]">
          {FIELD_TYPES.map(([t, l]) => (
            <option key={t} value={t}>{l}</option>
          ))}
        </select>
        <Button variant="primary" onClick={create} disabled={!name.trim()}>
          <Plus size={14} /> Add
        </Button>
      </div>
    </Modal>
  )
}
