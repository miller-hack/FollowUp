import { useEffect } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { TimePage } from '@/features/time/TimePage'
import { GoalsPage } from '@/features/goals/GoalsPage'
import { AutomationsPage } from '@/features/automations/AutomationsPage'
import { InboxPage } from '@/features/mail/InboxPage'
import { FollowUpsPage } from '@/features/mail/FollowUpsPage'
import { ComposeDialog } from '@/features/mail/Compose'
import { CalendarPage } from '@/features/calendar/CalendarPage'
import { DashboardsPage } from '@/features/dashboards/DashboardsPage'
import { X } from 'lucide-react'
import { queryClient, useSettings } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'
import { Sidebar } from '@/features/sidebar/Sidebar'
import { Home } from '@/features/home/Home'
import { LocationPage } from '@/features/views/LocationPage'
import { Settings } from '@/features/settings/Settings'
import { TaskPanel } from '@/features/tasks/TaskPanel'
import { QuickAdd } from '@/features/tasks/QuickAdd'
import { CommandPalette } from '@/features/search/CommandPalette'
import { AssistantPanel } from '@/features/ai/AssistantPanel'
import { handleAiEvent } from '@/features/ai/stream'

function useTheme() {
  const { data } = useSettings()
  const theme = data?.theme ?? 'system'
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && mq.matches))
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'k') {
        e.preventDefault()
        useUi.getState().setPalette(true)
      }
      if (k === 'j') {
        e.preventDefault()
        const ui = useUi.getState()
        if (ui.assistantOpen) ui.closeAssistant()
        else ui.openAssistant()
      }
      if (k === 'n') {
        e.preventDefault()
        useUi.getState().openQuickAdd()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Events from the main process (tray menu, notification clicks). */
function useAppEvents() {
  const navigate = useNavigate()
  useEffect(
    () =>
      window.bridge.onAppEvent((e) => {
        if (e.type === 'open-task') useUi.getState().openTask(e.taskId)
        if (e.type === 'quick-add') useUi.getState().openQuickAdd()
        if (e.type === 'navigate') navigate(e.path)
        if (e.type === 'ai') handleAiEvent(e.event)
        if (e.type === 'update') queryClient.setQueryData(['updateStatus'], e.status)
        if (e.type === 'compose') useUi.getState().openCompose({ ...e.draft, account_id: e.draft.account_id ?? undefined })
      }),
    [navigate]
  )
}

/** Overlay regions show their error as a floating card. */
const PANEL_ERROR = 'fixed top-4 right-4 z-[70] w-96'

function Toasts() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)
  return (
    <div className="fixed right-4 bottom-4 z-[60] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            'flex max-w-sm items-start gap-2 rounded-lg border px-3 py-2 text-[13px] shadow-lg',
            t.kind === 'error' ? 'border-danger/40 bg-panel text-danger' : 'border-line bg-panel'
          )}
        >
          <span className="flex-1">{t.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-muted">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

export default function App() {
  useTheme()
  useShortcuts()
  useAppEvents()
  const { pathname } = useLocation()
  const openTaskId = useUi((s) => s.openTaskId)
  const chatId = useUi((s) => s.assistantChatId)
  // each region fails on its own: a bad value in one view never blanks the window (ADR-005)
  return (
    <div className="flex h-full">
      <ErrorBoundary name="the sidebar" className="w-64">
        <Sidebar />
      </ErrorBoundary>
      <main className="min-w-0 flex-1">
        <ErrorBoundary name="this page" resetKey={pathname}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/everything" element={<LocationPage everything />} />
          <Route path="/l/:kind/:id" element={<LocationPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/time" element={<TimePage />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/automations" element={<AutomationsPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/followups" element={<FollowUpsPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/dashboards" element={<DashboardsPage />} />
          <Route path="/dashboards/:id" element={<DashboardsPage />} />
        </Routes>
        </ErrorBoundary>
      </main>
      <ErrorBoundary name="the assistant" resetKey={chatId} onDismiss={() => useUi.getState().closeAssistant()} className={PANEL_ERROR}>
        <AssistantPanel />
      </ErrorBoundary>
      <ErrorBoundary name="the task" resetKey={openTaskId} onDismiss={() => useUi.getState().openTask(null)} className={PANEL_ERROR}>
        <TaskPanel />
      </ErrorBoundary>
      <ErrorBoundary name="quick add" onDismiss={() => useUi.getState().closeQuickAdd()} className={PANEL_ERROR}>
        <QuickAdd />
      </ErrorBoundary>
      <ErrorBoundary name="search" onDismiss={() => useUi.getState().setPalette(false)} className={PANEL_ERROR}>
        <CommandPalette />
      </ErrorBoundary>
      <ErrorBoundary name="the email" onDismiss={() => useUi.getState().closeCompose()} className={PANEL_ERROR}>
        <ComposeDialog />
      </ErrorBoundary>
      <Toasts />
    </div>
  )
}
