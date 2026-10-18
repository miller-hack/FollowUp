import type { Api } from '@shared/api'
import { toast } from '@/stores/ui'

type Promisified<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never
}

function cleanError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e)
  // "Error invoking remote method 'api': Error: actual message"
  return new Error(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
}

/** Typed client for the main-process API. Errors surface as a toast and are re-thrown. */
export const api = new Proxy({} as Promisified<Api>, {
  get:
    (_target, method: string) =>
    async (...args: unknown[]) => {
      try {
        return await window.bridge.invoke(method, args)
      } catch (e) {
        const err = cleanError(e)
        toast(err.message, 'error')
        throw err
      }
    }
})
