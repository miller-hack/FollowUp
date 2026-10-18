import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const subscribe =
  (channel: 'data-changed' | 'app-event') =>
  (cb: (payload: unknown) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: unknown): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }

const bridge = {
  invoke: (method: string, args: unknown[]): Promise<unknown> => ipcRenderer.invoke('api', method, args),
  onDataChanged: subscribe('data-changed'),
  onAppEvent: subscribe('app-event')
}

contextBridge.exposeInMainWorld('bridge', bridge)
