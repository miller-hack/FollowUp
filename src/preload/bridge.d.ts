import type { AppEvent } from '../shared/api'

export interface Bridge {
  invoke(method: string, args: unknown[]): Promise<unknown>
  onDataChanged(cb: (info: { method: string }) => void): () => void
  onAppEvent(cb: (event: AppEvent) => void): () => void
}

declare global {
  interface Window {
    bridge: Bridge
  }
}
