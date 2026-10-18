import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  children: ReactNode
  /** what failed, for the message ("this page", "the task panel", …) */
  name: string
  /** a change (e.g. the route or the open task) clears the error */
  resetKey?: unknown
  /** offered as "Close" next to "Try again" (panels and dialogs) */
  onDismiss?: () => void
  className?: string
}

interface State {
  error: Error | null
}

/**
 * Keeps a rendering error inside one region instead of blanking the whole window
 * (ADR-005). The rest of the app keeps working; "Try again" re-renders the region.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Error in ${this.props.name}`, error, info.componentStack)
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" className={cn('m-4 rounded-xl border border-danger/40 bg-panel p-4 text-[13px] shadow-lg', this.props.className)}>
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Something went wrong showing {this.props.name}.</p>
            <p className="mt-1 break-words text-xs text-muted select-text">{error.message}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => this.setState({ error: null })}
                className="h-7 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg hover:brightness-110"
              >
                Try again
              </button>
              {this.props.onDismiss && (
                <button
                  type="button"
                  onClick={() => {
                    this.setState({ error: null })
                    this.props.onDismiss?.()
                  }}
                  className="h-7 rounded-md border border-line px-3 text-xs hover:bg-hover"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }
}
