import { format } from 'date-fns'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts'
import { parseLocal } from '@shared/dates'
import type { BreakdownItem, SprintStats } from '@shared/types'
import { cn, formatMinutes } from '@/lib/utils'

/** Categorical slot colors, assigned in fixed order (never cycled; the 9th+ is folded into "Other" upstream). */
export const seriesColor = (i: number): string => (i < 8 ? `var(--series-${i + 1})` : 'var(--series-other)')

const fmtValue = (v: number, unit: 'tasks' | 'minutes') => (unit === 'minutes' ? formatMinutes(v) || '0m' : v.toLocaleString())

const AXIS = { stroke: 'var(--chart-axis)', fontSize: 11, tick: { fill: 'var(--app-muted)' }, tickLine: false }

function ChartTooltip({ active, payload, label, unit = 'tasks' }: TooltipProps<number, string> & { unit?: 'tasks' | 'minutes' }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs shadow-lg">
      <div className="mb-0.5 text-muted">{label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="ml-auto pl-3 font-semibold tabular-nums">{p.value == null ? '—' : fmtValue(Number(p.value), unit)}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Horizontal bar list: a label, a thin bar and the value on every row. Doubles as the
 * table view, so low-contrast palette slots never carry identity alone.
 */
export function BarList({ items, unit, empty = 'No data yet' }: { items: BreakdownItem[]; unit: 'tasks' | 'minutes'; empty?: string }) {
  if (!items.length) return <div className="py-6 text-center text-xs text-muted">{empty}</div>
  const max = Math.max(...items.map((i) => i.value), 1)
  const total = items.reduce((a, i) => a + i.value, 0)
  return (
    <ul className="space-y-2">
      {items.map((it, i) => {
        const color = it.key === 'other' ? 'var(--series-other)' : (it.color ?? seriesColor(i))
        return (
          <li key={it.key} title={`${it.label}: ${fmtValue(it.value, unit)} (${Math.round((it.value / (total || 1)) * 100)}%)`}>
            <div className="mb-1 flex items-center gap-2 text-xs">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              <span className="font-semibold tabular-nums">{fmtValue(it.value, unit)}</span>
            </div>
            <div className="h-2 rounded-r bg-hover">
              <div className="h-full rounded-r" style={{ width: `${(it.value / max) * 100}%`, minWidth: it.value ? 3 : 0, background: color }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Single-series column chart over days (title names the series, so no legend box). */
export function DailyColumns({ points, unit = 'tasks', height = 170 }: { points: { date: string; value: number }[]; unit?: 'tasks' | 'minutes'; height?: number }) {
  const data = points.map((p) => ({ ...p, label: format(parseLocal(p.date), 'MMM d') }))
  const total = points.reduce((a, p) => a + p.value, 0)
  return (
    <div>
      <div className="mb-2 text-2xl font-semibold">{fmtValue(total, unit)}</div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={16} />
          <YAxis {...AXIS} allowDecimals={false} axisLine={false} width={44} />
          <Tooltip cursor={{ fill: 'var(--app-hover)' }} content={<ChartTooltip unit={unit} />} />
          <Bar dataKey="value" name="Completed" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Sprint burndown: remaining vs ideal (two series → legend). */
export function Burndown({ stats, height = 200, showTotals = true }: { stats: SprintStats; height?: number; showTotals?: boolean }) {
  const data = stats.days.map((d) => ({ ...d, label: format(parseLocal(d.date), 'MMM d') }))
  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: 'var(--series-1)' }} /> Remaining tasks
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: 'var(--series-other)' }} /> Ideal
        </span>
        {showTotals && (
          <span className="ml-auto">
            {stats.done}/{stats.total} done
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -24 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={16} />
          <YAxis {...AXIS} allowDecimals={false} axisLine={false} width={44} domain={[0, Math.max(1, stats.total)]} />
          <Tooltip content={<ChartTooltip />} />
          <Line dataKey="ideal" name="Ideal" stroke="var(--series-other)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line
            dataKey="remaining"
            name="Remaining"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={{ r: 4, fill: 'var(--series-1)', stroke: 'var(--app-panel)', strokeWidth: 2 }}
            activeDot={{ r: 5, stroke: 'var(--app-panel)', strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ProgressBar({ value, color, className }: { value: number; color?: string; className?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-hover', className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color ?? 'var(--app-accent)' }} />
    </div>
  )
}

export function StatValue({ value, unit, caption }: { value: number; unit: 'tasks' | 'minutes'; caption: string }) {
  return (
    <div>
      <div className="text-3xl font-semibold">{unit === 'minutes' ? formatMinutes(value) || '0m' : value.toLocaleString()}</div>
      <div className="mt-0.5 text-xs text-muted">{caption}</div>
    </div>
  )
}
