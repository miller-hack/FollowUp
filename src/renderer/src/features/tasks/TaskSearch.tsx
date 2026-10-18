import { useEffect, useState } from 'react'
import type { TaskRef } from '@shared/types'
import { api } from '@/lib/api'
import { Input, MenuItem } from '@/components/ui'

/** Search box + results for picking a task. */
export function TaskSearch({ exclude, onPick }: { exclude: string[]; onPick: (t: TaskRef) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<TaskRef[]>([])
  useEffect(() => {
    if (!q.trim()) return setResults([])
    const h = setTimeout(async () => setResults((await api.search(q)).tasks.filter((t) => !exclude.includes(t.id))), 150)
    return () => clearTimeout(h)
  }, [q, exclude])
  return (
    <div className="w-72">
      <Input autoFocus placeholder="Search tasks…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-1 max-h-60 overflow-auto">
        {results.map((t) => (
          <MenuItem key={t.id} onClick={() => onPick(t)}>
            {t.title}
          </MenuItem>
        ))}
        {q && results.length === 0 && <div className="p-2 text-xs text-muted">No matches</div>}
      </div>
    </div>
  )
}
