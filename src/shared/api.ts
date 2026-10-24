import type { Automation, AutomationInput, AutomationRun, TestResult } from './automation'
import type { ClientFilter, ClientSuggestion, Company, CompanyInput, CrmStage, ImportMapping, ImportPreview, Interaction, InteractionInput, Person, PersonInput, TeamMember, TimelineItem } from './crm'
import type { Integration, IntegrationInput, OAuthClientStatus, OAuthProvider, OutgoingMessage, UpdateStatus } from './integrations'
import type { AiKeyStatus, AiUsageSummary, ChatConversation, ChatDetail, ParsedQuickAdd, RewriteStyle, TriageResult } from './ai'
import type {
  Account,
  AccountInput,
  DetectedMailSettings,
  CalendarEvent,
  CalendarInfo,
  ComposeInput,
  EmailTemplate,
  EventInput,
  FollowUpCounts,
  FollowUpDraft,
  MailFolderInfo,
  MailThread,
  OutboxItem,
  ThreadDetail,
  ThreadQuery
} from './mail'
import type {
  AppNotification,
  Dashboard,
  Goal,
  KeyResult,
  KeyResultInput,
  Reminder,
  RunningTimer,
  Sprint,
  SprintStats,
  TimeEntry,
  TimeEntryRow,
  Widget,
  WidgetConfig,
  WidgetData,
  WidgetType,
  Attachment,
  BackupInfo,
  Checklist,
  ChecklistItem,
  Comment,
  CustomField,
  FieldOption,
  FieldType,
  Folder,
  List,
  MyWork,
  NewTask,
  SearchResult,
  Settings,
  Space,
  StatusInput,
  Tag,
  Task,
  TaskDetail,
  TaskFilter,
  TaskPatch,
  Tree,
  ViewConfig
} from './types'

/**
 * The full IPC contract. Implemented in the main process, called from the
 * renderer through `window.api.invoke(method, args)`.
 * Methods starting with `get`, `list`, `query` or `search` are read-only; every
 * other call broadcasts a `data-changed` event after it succeeds.
 */
export interface Api {
  // hierarchy
  getTree(): Tree
  createSpace(input: { name: string; color?: string }): Space
  updateSpace(id: string, patch: Partial<Pick<Space, 'name' | 'color'>>): void
  deleteSpace(id: string): void
  createFolder(input: { space_id: string; name: string }): Folder
  updateFolder(id: string, patch: Partial<Pick<Folder, 'name'>>): void
  deleteFolder(id: string): void
  createList(input: { space_id: string; folder_id?: string | null; name: string }): List
  updateList(id: string, patch: Partial<Pick<List, 'name' | 'color' | 'folder_id' | 'space_id'>>): void
  deleteList(id: string): void
  reorder(kind: 'space' | 'folder' | 'list', ids: string[]): void
  saveStatuses(spaceId: string, statuses: StatusInput[]): void

  // tags & custom fields
  listTags(): Tag[]
  createTag(input: { name: string; color?: string }): Tag
  updateTag(id: string, patch: Partial<Pick<Tag, 'name' | 'color'>>): void
  deleteTag(id: string): void
  listFields(spaceId?: string): CustomField[]
  createField(input: { space_id: string; name: string; type: FieldType; options?: FieldOption[] }): CustomField
  updateField(id: string, patch: Partial<Pick<CustomField, 'name' | 'options'>>): void
  deleteField(id: string): void

  // tasks
  queryTasks(filter: TaskFilter): Task[]
  getTask(id: string): TaskDetail | null
  createTask(input: NewTask): Task
  updateTask(id: string, patch: TaskPatch): Task
  bulkUpdateTasks(ids: string[], patch: TaskPatch): void
  deleteTasks(ids: string[]): void
  moveTask(id: string, target: { status_id?: string; list_id?: string; beforeId?: string | null }): void
  duplicateTask(id: string): Task

  // task parts
  addChecklist(taskId: string, name: string): Checklist
  updateChecklist(id: string, name: string): void
  deleteChecklist(id: string): void
  addChecklistItem(checklistId: string, text: string): ChecklistItem
  updateChecklistItem(id: string, patch: Partial<Pick<ChecklistItem, 'text' | 'done'>>): void
  deleteChecklistItem(id: string): void
  addComment(taskId: string, body: string): Comment
  deleteComment(id: string): void
  addAttachments(taskId: string): Attachment[]
  openAttachment(id: string): void
  deleteAttachment(id: string): void
  addDependency(taskId: string, blockedById: string): void
  removeDependency(taskId: string, blockedById: string): void

  // time tracking
  getRunningTimer(): RunningTimer | null
  startTimer(taskId: string): TimeEntry
  stopTimer(): TimeEntry | null
  addTimeEntry(input: { task_id: string; started_at: string; duration_min: number; note?: string; billable?: boolean }): TimeEntry
  updateTimeEntry(id: string, patch: { started_at?: string; duration_min?: number; note?: string; billable?: boolean }): void
  deleteTimeEntry(id: string): void
  listTimeEntries(q: { from: string; to: string; taskId?: string }): TimeEntryRow[]
  exportTimeCsv(from: string, to: string): string | null

  // goals
  listGoals(): Goal[]
  createGoal(input: { name: string; color?: string; due_date?: string | null; description?: string }): Goal
  updateGoal(id: string, patch: Partial<Pick<Goal, 'name' | 'description' | 'color' | 'due_date'>>): void
  deleteGoal(id: string): void
  addKeyResult(goalId: string, input: KeyResultInput): void
  updateKeyResult(id: string, patch: Partial<Pick<KeyResult, 'name' | 'start_value' | 'target_value' | 'current_value' | 'unit'>>): void
  deleteKeyResult(id: string): void
  linkKeyResultTask(krId: string, taskId: string): void
  unlinkKeyResultTask(krId: string, taskId: string): void

  // sprints
  createSprint(input: { space_id: string; name?: string; start_date?: string; end_date?: string; goal?: string }): Sprint
  updateSprint(id: string, patch: Partial<Pick<Sprint, 'name' | 'start_date' | 'end_date' | 'status' | 'goal'>>): void
  deleteSprint(id: string): void
  completeSprint(id: string): { next: Sprint; moved: number }
  getSprintStats(id: string): SprintStats | null

  // dashboards
  listDashboards(): { id: string; name: string }[]
  getDashboard(id: string): Dashboard | null
  createDashboard(name: string): { id: string; name: string }
  updateDashboard(id: string, patch: { name?: string }): void
  deleteDashboard(id: string): void
  addWidget(dashboardId: string, input: { type: WidgetType; title: string; config?: WidgetConfig; size?: number }): Widget
  updateWidget(id: string, patch: Partial<Pick<Widget, 'title' | 'config' | 'size'>>): void
  deleteWidget(id: string): void
  reorderWidgets(ids: string[]): void
  getWidgetData(widgetId: string): WidgetData

  // reminders & notifications
  listReminders(opts?: { includeDone?: boolean }): (Reminder & { task_title: string | null })[]
  createReminder(input: { task_id?: string | null; title?: string; remind_at: string }): Reminder
  updateReminder(id: string, patch: { title?: string; remind_at?: string; done?: boolean }): void
  deleteReminder(id: string): void
  listNotifications(): AppNotification[]
  markNotificationsRead(ids?: string[]): void
  clearNotifications(): void

  // automations
  listAutomations(): Automation[]
  createAutomation(input: AutomationInput): Automation
  updateAutomation(id: string, patch: Partial<AutomationInput>): Automation
  deleteAutomation(id: string): void
  duplicateAutomation(id: string): Automation
  listAutomationRuns(automationId?: string): AutomationRun[]
  testAutomation(input: AutomationInput, taskId: string | null): TestResult
  runAutomationNow(id: string, taskId: string | null): void

  // accounts
  listAccounts(): Account[]
  createAccount(input: AccountInput): Account
  updateAccount(id: string, patch: Partial<AccountInput> & { enabled?: boolean }): Account
  deleteAccount(id: string): void
  testAccount(input: AccountInput & { accountId?: string }): Promise<{ imap: string | null; smtp: string | null; caldav: string | null; calendars?: number }>
  /** IMAP/SMTP settings for an address (provider, MX records, autoconfig, common host names); null when unknown */
  getMailSettingsFor(email: string): Promise<DetectedMailSettings | null>
  syncAccount(id: string): void
  syncAllAccounts(): number

  // mail
  listThreads(q: ThreadQuery): MailThread[]
  getThread(id: string): ThreadDetail | null
  getUnreadCount(): number
  markThreadRead(id: string, read: boolean): void
  setThreadDone(id: string, done: boolean): void
  sendEmail(input: ComposeInput): OutboxItem
  /** save a draft in the server's Drafts folder (replacing an earlier version); returns its id */
  saveDraft(input: ComposeInput, replaces?: string | null): Promise<string>
  discardDraft(messageId: string): void
  listOutbox(threadId?: string): (OutboxItem & { thread_id: string | null })[]
  retryOutbox(id: string): void
  cancelOutbox(id: string): void
  openMailAttachment(id: string): void
  createTaskFromThread(threadId: string, listId: string): Task
  linkThreadTask(threadId: string, taskId: string): void
  unlinkThreadTask(threadId: string, taskId: string): void
  listEmailTemplates(): EmailTemplate[]
  saveEmailTemplate(input: Partial<EmailTemplate> & { name: string }): EmailTemplate
  deleteEmailTemplate(id: string): void

  /** server folders of the mail accounts (all accounts when omitted) */
  listMailFolders(accountId?: string | null): MailFolderInfo[]
  /** move a conversation's messages between server folders: by role ('inbox', 'archive', 'spam', 'trash') or 'folder:<path>' */
  moveThread(threadId: string, from: string, to: string): void
  /** permanently delete a conversation that is in Spam or Trash */
  deleteThreadForever(threadId: string): void

  // follow-up (ADR-015)
  getFollowUpCounts(): FollowUpCounts
  /** a follow-up email to edit and send (AI-written when AI is set up) */
  getFollowUpDraft(threadId: string, instructions?: string): Promise<FollowUpDraft>
  snoozeFollowUp(threadId: string, until: string): void
  dismissFollowUp(threadId: string): void
  restoreFollowUp(threadId: string): void

  // clients (ADR-016)
  listClients(filter?: ClientFilter): Company[]
  getClientTimeline(companyId: string, personId?: string | null): TimelineItem[]
  listCrmStages(): CrmStage[]
  saveCrmStages(stages: Omit<CrmStage, 'position'>[]): CrmStage[]
  listTeam(): TeamMember[]
  saveTeamMember(input: Partial<TeamMember> & { name: string }): TeamMember
  deleteTeamMember(id: string): void
  createCompany(input: CompanyInput): Company
  updateCompany(id: string, patch: Partial<CompanyInput>): void
  deleteCompany(id: string): void
  createPerson(input: PersonInput): Person
  updatePerson(id: string, patch: Partial<PersonInput>): void
  deletePerson(id: string): void
  logInteraction(input: InteractionInput): Interaction
  updateInteraction(id: string, patch: Partial<InteractionInput>): void
  deleteInteraction(id: string): void
  listClientSuggestions(): ClientSuggestion[]
  addClientSuggestion(input: { people: { address: string; name: string }[]; company_id?: string | null; company_name?: string; domain?: string | null }): Company
  ignoreClientSuggestion(addresses: string[]): void
  /** pick an .xlsx / .csv file and preview it (null when cancelled) */
  chooseClientImport(): Promise<ImportPreview | null>
  runClientImport(token: string, mapping: ImportMapping): { companies: number; people: number; updated: number; skipped: number }
  /** save the client list as a spreadsheet; returns the file path (null when cancelled) */
  exportClients(format: 'xlsx' | 'csv'): Promise<string | null>

  // calendar
  listCalendars(): CalendarInfo[]
  updateCalendar(id: string, patch: Partial<Pick<CalendarInfo, 'name' | 'color' | 'enabled'>>): void
  listEvents(from: string, to: string): CalendarEvent[]
  createEvent(input: EventInput): CalendarEvent
  updateEvent(eventId: string, patch: Partial<EventInput>): void
  deleteEvent(eventId: string): void
  createEventForTask(taskId: string, calendarId?: string): CalendarEvent

  // AI
  getAiKeyStatus(): AiKeyStatus
  setAiKey(provider: 'anthropic' | 'openai', key: string | null): void
  testAi(): Promise<{ ok: boolean; message: string }>
  getAiUsage(): AiUsageSummary
  listChats(): ChatConversation[]
  getChat(id: string): ChatDetail | null
  sendChat(conversationId: string | null, text: string): string
  resolveChatTools(conversationId: string, decisions: Record<string, boolean>): void
  stopChat(conversationId: string): void
  deleteChat(conversationId: string): void
  aiSummarizeTask(taskId: string): Promise<{ summary: string; next_steps: string[] }>
  aiSuggestSubtasks(taskId: string): Promise<string[]>
  aiRewrite(text: string, style: RewriteStyle): Promise<string>
  aiParseQuickAdd(text: string): Promise<ParsedQuickAdd>
  aiWeeklyReview(): Promise<string>
  aiSummarizeThread(threadId: string): Promise<{ summary: string; action_items: string[] }>
  aiDraftReply(threadId: string, instructions: string, senderName: string): Promise<string>
  aiExtractTasks(threadId: string): Promise<{ title: string; due_date: string | null }[]>
  aiTriageThread(threadId: string): Promise<TriageResult>
  aiTriageInbox(): number

  // Slack / Teams
  listIntegrations(): Integration[]
  createIntegration(input: IntegrationInput): Integration
  updateIntegration(id: string, patch: Partial<IntegrationInput> & { enabled?: boolean }): Integration
  deleteIntegration(id: string): void
  /** sends a test message; returns an error message or null */
  testIntegration(input: IntegrationInput & { id?: string }): Promise<string | null>
  listSlackChannels(input: { token?: string; id?: string }): Promise<{ id: string; name: string; member: boolean }[]>
  postToIntegration(id: string, message: OutgoingMessage): void
  /** check the watched Slack channel now; returns tasks created */
  syncIntegration(id: string): Promise<number>

  // Google / Microsoft sign-in
  getOAuthClients(): Record<OAuthProvider, OAuthClientStatus>
  setOAuthClient(provider: OAuthProvider, clientId: string, secret?: string | null): void
  /** opens the browser; resolves with the added / reconnected accounts */
  signInWithProvider(provider: OAuthProvider, reconnectAccountId?: string): Promise<Account[]>
  cancelSignIn(): void

  // updates
  getUpdateStatus(): UpdateStatus
  checkForUpdates(): void
  installUpdate(): void

  // misc
  exportIcs(): string | null
  search(query: string): SearchResult
  getMyWork(): MyWork
  getViewConfig(key: string): ViewConfig | null
  setViewConfig(key: string, config: ViewConfig): void
  getSettings(): Settings
  updateSettings(patch: Partial<Settings>): Settings
  /** remember a panel or column width (null = back to default); never refreshes other views */
  setUiWidth(key: string, width: number | null): void
  backupNow(): BackupInfo
  listBackups(): BackupInfo[]
  getDataPath(): string
  openDataFolder(): void
  exportJson(): string | null
}

export type ApiMethod = keyof Api

export const READ_ONLY_PREFIXES = ['get', 'list', 'query', 'search', 'test']

/** Mutations that never affect data shown elsewhere, so they don't trigger a refetch. */
const QUIET_METHODS = new Set(['setViewConfig', 'setUiWidth', 'exportClients', 'chooseClientImport', 'openAttachment', 'openDataFolder', 'exportJson', 'exportTimeCsv', 'exportIcs', 'cancelSignIn', 'checkForUpdates', 'installUpdate'])

/** Events the main process pushes to the renderer (besides `data-changed`). */
export type AppEvent =
  | { type: 'open-task'; taskId: string }
  | { type: 'quick-add' }
  | { type: 'navigate'; path: string }
  | { type: 'ai'; event: AiEvent }
  | { type: 'update'; status: UpdateStatus }
  | { type: 'compose'; draft: { to: string; subject: string; body: string; reply_to: string | null; account_id: string | null } }

import type { AiEvent } from './ai'

export function isReadOnly(method: string): boolean {
  return QUIET_METHODS.has(method) || READ_ONLY_PREFIXES.some((p) => method.startsWith(p))
}
