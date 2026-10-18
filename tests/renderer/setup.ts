import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// ---- the IPC bridge (preload) is replaced by per-test handlers
export const handlers: Record<string, (...args: unknown[]) => unknown> = {}
Object.defineProperty(window, 'bridge', {
  value: {
    invoke: vi.fn(async (method: string, args: unknown[]) => (handlers[method] ? handlers[method](...args) : null)),
    onDataChanged: () => () => {},
    onAppEvent: () => () => {}
  }
})

// ---- browser APIs jsdom does not implement
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver
// ProseMirror measures the selection when it scrolls it into view
const emptyRects = (): DOMRectList => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getClientRects ??= emptyRects
Range.prototype.getBoundingClientRect ??= () => new DOMRect()
Element.prototype.scrollIntoView ??= () => {}
document.elementFromPoint ??= () => null

afterEach(() => {
  cleanup()
  for (const k of Object.keys(handlers)) delete handlers[k]
  vi.restoreAllMocks()
})
