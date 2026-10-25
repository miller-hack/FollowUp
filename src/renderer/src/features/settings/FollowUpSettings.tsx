import { useEffect, useState } from 'react'
import type { FollowUpSettings } from '@shared/mail'
import type { Settings } from '@shared/types'
import { useAccounts } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { Input, Toggle } from '@/components/ui'
import { Select } from '@/components/selects'

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const FREE = /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|zoho|gmx|yandex|mail)\./

const hoursLabel = (h: number) => (h % 24 === 0 ? `${h / 24} working day${h === 24 ? '' : 's'}` : `${h} working hours`)

/** Settings → Email: who counts as "us", working days and waiting times for Follow-up (ADR-015). */
export function FollowUpSettingsEditor({ settings, set }: { settings: Settings; set: (p: Partial<Settings>) => void }) {
  const f = settings.followups
  const { data: accounts = [] } = useAccounts()
  const [domains, setDomains] = useState(f.companyDomains.join(', '))
  useEffect(() => setDomains(f.companyDomains.join(', ')), [f.companyDomains])
  const update = (p: Partial<FollowUpSettings>) => set({ followups: { ...f, ...p } })
  const accountDomains = [...new Set(accounts.filter((a) => a.kind === 'mail').map((a) => a.email.split('@')[1]).filter((d) => d && !FREE.test(d)))]

  return (
    <div className="space-y-3 text-[13px]">
      <div>
        <div className="font-medium">Who counts as “us”</div>
        <p className="text-xs text-muted">
          A reply from any of these counts as answered, so a conversation leaves “Reply needed” when a teammate replies with you in copy.
        </p>
        <div className="mt-2 space-y-2">
          <Toggle
            label={`Your mailboxes’ own domains${accountDomains.length ? ` (${accountDomains.join(', ')})` : ''}`}
            hint="Public mailboxes such as gmail.com are never treated as your company."
            checked={f.includeAccountDomains}
            onChange={(includeAccountDomains) => update({ includeAccountDomains })}
          />
          <label className="block">
            <span className="text-xs text-muted">Other company domains, separated by commas</span>
            <Input
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              onBlur={() => {
                const list = domains.split(/[\s,;]+/).map((d) => d.trim().replace(/^@/, '')).filter(Boolean)
                if (list.join(',') !== f.companyDomains.join(',')) update({ companyDomains: list })
              }}
              placeholder="ourcompany.com, ourcompany.co.uk"
              className="mt-1"
              spellCheck={false}
            />
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span>
          Working days
          <span className="block text-xs text-muted">Waiting time only counts on these days.</span>
        </span>
        <div className="flex gap-1">
          {DAYS.map((d, i) => {
            const on = f.workingDays.includes(i)
            return (
              <button
                key={i}
                type="button"
                aria-pressed={on}
                aria-label={DAY_NAMES[i]}
                title={DAY_NAMES[i]}
                onClick={() => {
                  const next = on ? f.workingDays.filter((x) => x !== i) : [...f.workingDays, i].sort()
                  if (next.length) update({ workingDays: next })
                }}
                className={cn('h-7 w-7 rounded-full border text-xs', on ? 'border-accent bg-accent text-accent-fg' : 'border-line text-muted hover:text-fg')}
              >
                {d}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span>
          “Reply needed” after
          <span className="block text-xs text-muted">Someone wrote and nobody on your side answered.</span>
        </span>
        <Select value={f.replyAfterHours} onChange={(e) => update({ replyAfterHours: Number(e.target.value) })} aria-label="Reply needed after">
          {[4, 8, 12, 24, 48, 72].map((h) => (
            <option key={h} value={h}>{hoursLabel(h)}</option>
          ))}
        </Select>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span>
          “Waiting on them” after
          <span className="block text-xs text-muted">You wrote and they haven’t answered.</span>
        </span>
        <Select value={f.nudgeAfterHours} onChange={(e) => update({ nudgeAfterHours: Number(e.target.value) })} aria-label="Waiting on them after">
          {[24, 30, 48, 72, 120, 168].map((h) => (
            <option key={h} value={h}>{h === 30 ? '30 working hours' : hoursLabel(h)}</option>
          ))}
        </Select>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span>
          Look back
          <span className="block text-xs text-muted">Older conversations are never brought up.</span>
        </span>
        <Select value={f.lookbackDays} onChange={(e) => update({ lookbackDays: Number(e.target.value) })} aria-label="Look back">
          {[7, 14, 30, 60, 90].map((d) => (
            <option key={d} value={d}>{d} days</option>
          ))}
        </Select>
      </div>
      <Toggle
        label="Daily reminder"
        hint="One notification at the daily summary time when emails need follow-up."
        checked={f.dailyReminder}
        onChange={(dailyReminder) => update({ dailyReminder })}
      />
    </div>
  )
}
