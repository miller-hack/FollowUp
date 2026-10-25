import { useCallback, useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Resizable panels and columns: drag the edge, use ←/→ on the focused handle, double-click to
 * reset. Widths are remembered per key in settings (`ui.widths`) without refreshing other views.
 */

interface WidthStore {
  loaded: boolean
  widths: Record<string, number>
  load: () => Promise<void>
  set: (key: string, w: number | null, persist?: boolean) => void
}

const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const useWidths = create<WidthStore>((set, getState) => ({
  loaded: false,
  widths: {},
  load: async () => {
    if (getState().loaded) return
    try {
      const s = await window.bridge.invoke('getSettings', [])
      set({ loaded: true, widths: { ...((s as { ui?: { widths?: Record<string, number> } }).ui?.widths ?? {}) } })
    } catch {
      set({ loaded: true })
    }
  },
  set: (key, w, persist = true) => {
    const widths = { ...getState().widths }
    if (w === null) delete widths[key]
    else widths[key] = w
    set({ widths })
    if (!persist) return
    clearTimeout(persistTimers.get(key))
    persistTimers.set(
      key,
      setTimeout(() => void api.setUiWidth(key, w).catch(() => {}), 400)
    )
  }
}))

/** The remembered width for `key`, clamped to [min, max]. */
export function useWidth(key: string, initial: number, min: number, max: number): [number, (w: number | null, persist?: boolean) => void] {
  const { widths, load, set } = useWidths()
  useEffect(() => void load(), [load])
  const w = Math.min(max, Math.max(min, widths[key] ?? initial))
  const setW = useCallback((v: number | null, persist = true) => set(key, v === null ? null : Math.min(max, Math.max(min, Math.round(v))), persist), [key, min, max, set])
  return [w, setW]
}

/**
 * A vertical drag handle on the edge of a panel. `side` is where the handle sits relative to the
 * panel it resizes: 'right' grows the panel when dragged right, 'left' when dragged left.
 */
export function ResizeHandle({
  width,
  onResize,
  side = 'right',
  label,
  className
}: {
  width: number
  onResize: (w: number | null, persist?: boolean) => void
  side?: 'left' | 'right'
  label: string
  className?: string
}) {
  const start = useRef<{ x: number; w: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const sign = side === 'right' ? 1 : -1

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, w: width }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return
    onResize(start.current.w + sign * (e.clientX - start.current.x), false)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!start.current) return
    const next = start.current.w + sign * (e.clientX - start.current.x)
    start.current = null
    setDragging(false)
    onResize(next, true)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onResize(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          onResize(width + (e.key === 'ArrowRight' ? sign : -sign) * (e.shiftKey ? 50 : 10))
        }
      }}
      className={cn(
        // positioned by the caller: 'absolute …' on an edge, or 'relative' between flex panels (cn doesn't merge conflicting classes)
        'group z-10 w-1.5 shrink-0 cursor-col-resize touch-none select-none outline-none',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-accent/60 focus-visible:after:bg-accent',
        dragging && 'after:bg-accent',
        className
      )}
    />
  )
}

/** A panel whose width is remembered under `id`. */
export function ResizablePanel({
  id,
  initial,
  min,
  max,
  side = 'right',
  label,
  className,
  children
}: {
  id: string
  initial: number
  min: number
  max: number
  side?: 'left' | 'right'
  label: string
  className?: string
  children: React.ReactNode
}) {
  const [w, setW] = useWidth(id, initial, min, max)
  const handle = <ResizeHandle width={w} onResize={setW} side={side} label={label} className={side === 'right' ? 'relative -mr-1.5' : 'relative -ml-1.5'} />
  return (
    <>
      {side === 'left' && handle}
      <div className={cn('shrink-0', className)} style={{ width: w }}>
        {children}
      </div>
      {side === 'right' && handle}
    </>
  )
}
