import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Modal } from '@/components/ui'
import { DatePanel } from '@/features/tasks/pickers'

// ---------------------------------------------------------------- ErrorBoundary (ADR-005)

describe('ErrorBoundary', () => {
  function Bomb({ explode }: { explode: boolean }) {
    if (explode) throw new Error('bad date "next Tuesday"')
    return <p>all good</p>
  }

  it('contains a render error, shows it and recovers with Try again', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let explode = true
    function Flaky() {
      return <Bomb explode={explode} />
    }
    render(
      <div>
        <p>sidebar still here</p>
        <ErrorBoundary name="this page">
          <Flaky />
        </ErrorBoundary>
      </div>
    )
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong showing this page.')
    expect(screen.getByRole('alert').textContent).toContain('bad date "next Tuesday"')
    expect(screen.getByText('sidebar still here')).toBeTruthy()

    explode = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('all good')).toBeTruthy()
  })

  it('clears the error when the reset key changes and offers Close for panels', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onDismiss = vi.fn()
    const { rerender } = render(
      <ErrorBoundary name="the task panel" resetKey="task-1" onDismiss={onDismiss}>
        <Bomb explode />
      </ErrorBoundary>
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    rerender(
      <ErrorBoundary name="the task panel" resetKey="task-2" onDismiss={onDismiss}>
        <Bomb explode={false} />
      </ErrorBoundary>
    )
    expect(screen.getByText('all good')).toBeTruthy()

    rerender(
      <ErrorBoundary name="the task panel" resetKey="task-2" onDismiss={onDismiss}>
        <Bomb explode />
      </ErrorBoundary>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------- Modal discard confirmation (M12)

describe('Modal', () => {
  it('closes on Escape when nothing would be lost', () => {
    const onClose = vi.fn()
    render(<Modal title="Settings" onClose={onClose}>body</Modal>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('asks before discarding unsaved work (Escape, backdrop click and ×)', () => {
    const onClose = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <Modal title="New email" onClose={onClose} confirmDiscard>
        draft
      </Modal>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(confirm).toHaveBeenCalledTimes(3)
    expect(onClose).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not close when clicking inside the dialog', () => {
    const onClose = vi.fn()
    render(<Modal title="T" onClose={onClose}><input aria-label="field" /></Modal>)
    fireEvent.mouseDown(screen.getByLabelText('field'))
    expect(onClose).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------- DatePanel (M10)

describe('DatePanel', () => {
  const setup = (value: string | null = null) => {
    const onChange = vi.fn()
    const close = vi.fn()
    const utils = render(<DatePanel value={value} onChange={onChange} close={close} />)
    return { onChange, close, input: screen.getByLabelText('Date') as HTMLInputElement, ...utils }
  }

  it('saves a typed date once, on blur, not on every keystroke', () => {
    const { onChange, input } = setup()
    fireEvent.change(input, { target: { value: '2026-11-05' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledExactlyOnceWith('2026-11-05')
  })

  it('saves on Enter and closes', () => {
    const { onChange, close, input } = setup()
    fireEvent.change(input, { target: { value: '2026-12-01' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('2026-12-01')
    expect(close).toHaveBeenCalled()
  })

  it('saves a typed date when the panel closes before blur fires', () => {
    const { onChange, input, unmount } = setup()
    fireEvent.change(input, { target: { value: '2027-01-15' } })
    unmount()
    expect(onChange).toHaveBeenCalledExactlyOnceWith('2027-01-15')
  })

  it('ignores an unchanged date and offers quick picks', () => {
    const { onChange, close, input } = setup('2026-11-05')
    fireEvent.change(input, { target: { value: '2026-11-05' } })
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Clear date' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null)
    expect(close).toHaveBeenCalled()
  })
})
