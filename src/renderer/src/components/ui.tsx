import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import { cn, PALETTE } from '@/lib/utils'

// ---------------------------------------------------------------- buttons & inputs

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'outline' | 'danger'; size?: 'sm' | 'md' }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'outline', size = 'md', className, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'bg-accent text-accent-fg hover:brightness-110',
        variant === 'ghost' && 'hover:bg-hover text-fg',
        variant === 'outline' && 'border border-line bg-panel hover:bg-hover text-fg',
        variant === 'danger' && 'bg-danger text-white hover:brightness-110',
        className
      )}
      {...props}
    />
  )
})

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(
  function IconButton({ label, className, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        className={cn('inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg', className)}
        {...props}
      />
    )
  }
)

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-8 w-full rounded-md border border-line bg-panel px-2.5 text-[13px] text-fg outline-none placeholder:text-muted focus:border-accent',
        className
      )}
      {...props}
    />
  )
})

// ---------------------------------------------------------------- popover

interface PopoverProps {
  trigger: ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  align?: 'start' | 'end'
  className?: string
  triggerClassName?: string
  disabled?: boolean
}

/** Click-to-open floating panel, rendered in a portal so it is never clipped by scroll containers. */
export function Popover({ trigger, children, align = 'start', className, triggerClassName, disabled }: PopoverProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)

  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return
    const a = anchor.current.getBoundingClientRect()
    const p = panel.current.getBoundingClientRect()
    let top = a.bottom + 4
    if (top + p.height > window.innerHeight - 8) top = Math.max(8, a.top - p.height - 4)
    let left = align === 'end' ? a.right - p.width : a.left
    left = Math.min(Math.max(8, left), window.innerWidth - p.width - 8)
    setPos({ top, left })
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      // clicks inside nested popovers (separate portals) count as inside
      const inPopover = (t as Element).closest?.('[data-popover]')
      if (!panel.current?.contains(t) && !anchor.current?.contains(t) && !inPopover) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), close())
    const onResize = () => close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  return (
    <>
      <span
        ref={anchor}
        className={cn('inline-flex min-w-0', triggerClassName)}
        onClick={(e) => {
          e.stopPropagation()
          if (!disabled) setOpen((o) => !o)
        }}
      >
        {trigger}
      </span>
      {open &&
        createPortal(
          <div
            ref={panel}
            data-popover=""
            onClick={(e) => e.stopPropagation()}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className={cn('fixed z-50 min-w-40 rounded-lg border border-line bg-panel p-1 shadow-xl', className)}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>,
          document.body
        )}
    </>
  )
}

export function MenuItem({
  children,
  onClick,
  active,
  danger,
  icon
}: {
  children: ReactNode
  onClick?: () => void
  active?: boolean
  danger?: boolean
  icon?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover',
        danger ? 'text-danger' : 'text-fg'
      )}
    >
      {icon && <span className="flex w-4 justify-center text-muted">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {active && <Check size={14} className="text-accent" />}
    </button>
  )
}

export const MenuSeparator = () => <div className="my-1 h-px bg-line" />

// ---------------------------------------------------------------- modal

export function Modal({
  title,
  onClose,
  children,
  width = 480,
  footer,
  confirmDiscard = false
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  width?: number
  footer?: ReactNode
  /** the dialog holds unsaved work: Esc, a click outside or × ask before throwing it away */
  confirmDiscard?: boolean
}) {
  const titleId = useId()
  const requestClose = useRef(() => {})
  requestClose.current = () => {
    if (confirmDiscard && !window.confirm('Discard your changes?')) return
    onClose()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && requestClose.current()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 pt-[12vh]" onMouseDown={() => requestClose.current()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[76vh] flex-col rounded-xl border border-line bg-panel shadow-2xl"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id={titleId} className="text-[15px] font-semibold">{title}</h2>
          <IconButton label="Close" onClick={() => requestClose.current()}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="flex-1 overflow-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------- misc

export function ColorGrid({ value, onChange }: { value?: string | null; onChange: (c: string) => void }) {
  return (
    <div className="grid grid-cols-6 gap-1.5 p-1.5">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn('h-5 w-5 rounded-full ring-offset-2 ring-offset-panel', value === c && 'ring-2 ring-fg')}
          style={{ background: c }}
        />
      ))}
    </div>
  )
}

export function Dot({ color, size = 8, className }: { color: string; size?: number; className?: string }) {
  return <span className={cn('inline-block shrink-0 rounded-full', className)} style={{ background: color, width: size, height: size }} />
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-10 text-center text-muted">{children}</div>
}

/** Text that turns into an input on click; commits on Enter/blur. */
export function InlineEdit({
  value,
  onSave,
  className,
  inputClassName,
  autoEdit,
  onCancel
}: {
  value: string
  onSave: (v: string) => void
  className?: string
  inputClassName?: string
  autoEdit?: boolean
  onCancel?: () => void
}) {
  const [editing, setEditing] = useState(!!autoEdit)
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  if (!editing)
    return (
      <span className={cn('cursor-text truncate', className)} onClick={() => setEditing(true)}>
        {value}
      </span>
    )
  const commit = () => {
    setEditing(false)
    const v = text.trim()
    if (v && v !== value) onSave(v)
    else onCancel?.()
  }
  return (
    <input
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          setText(value)
          setEditing(false)
          onCancel?.()
        }
      }}
      className={cn('w-full rounded border border-accent bg-panel px-1 outline-none', inputClassName)}
    />
  )
}

// ---------------------------------------------------------------- form controls

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line p-0.5">
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          className={cn('rounded-md px-3 py-1 text-[13px]', value === v ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line')}
      >
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      <span>
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  )
}
