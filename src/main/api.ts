import type { Api } from '@shared/api'
import * as hierarchy from './services/hierarchy'
import * as meta from './services/meta'
import * as tasks from './services/tasks'
import * as files from './services/files'
import * as time from './services/time'
import * as planning from './services/planning'
import * as dashboards from './services/dashboards'
import * as notify from './services/notify'
import * as automation from './services/automation'
import * as calendar from './services/calendar'
import * as aiProviders from './services/ai/providers'
import * as aiFeatures from './services/ai/features'
import * as assistant from './services/ai/assistant'
import * as accounts from './services/mail/accounts'
import * as integrations from './services/integrations'
import * as oauth from './services/oauth'
import * as updater from './services/updater'
import * as mail from './services/mail/index'
import * as send from './services/mail/send'
import * as sequences from './services/mail/sequences'
import * as store from './services/mail/store'
import { friendlyMailError } from './services/mail/transport'
import type { CalDavConfig } from '@shared/mail'
import { applySettings, markQuitting } from './desktop'

/** Main-process implementation of the IPC contract. */
export const api: Api = {
  getTree: hierarchy.getTree,
  createSpace: hierarchy.createSpace,
  updateSpace: hierarchy.updateSpace,
  deleteSpace: hierarchy.deleteSpace,
  createFolder: hierarchy.createFolder,
  updateFolder: hierarchy.updateFolder,
  deleteFolder: hierarchy.deleteFolder,
  createList: hierarchy.createList,
  updateList: hierarchy.updateList,
  deleteList: hierarchy.deleteList,
  reorder: hierarchy.reorder,
  saveStatuses: hierarchy.saveStatuses,

  listTags: meta.listTags,
  createTag: meta.createTag,
  updateTag: meta.updateTag,
  deleteTag: meta.deleteTag,
  listFields: meta.listFields,
  createField: meta.createField,
  updateField: meta.updateField,
  deleteField: meta.deleteField,

  queryTasks: tasks.queryTasks,
  getTask: tasks.getTask,
  createTask: (input) => tasks.createTask(input),
  updateTask: tasks.updateTask,
  bulkUpdateTasks: tasks.bulkUpdateTasks,
  deleteTasks: tasks.deleteTasks,
  moveTask: tasks.moveTask,
  duplicateTask: tasks.duplicateTask,

  addChecklist: tasks.addChecklist,
  updateChecklist: tasks.updateChecklist,
  deleteChecklist: tasks.deleteChecklist,
  addChecklistItem: tasks.addChecklistItem,
  updateChecklistItem: tasks.updateChecklistItem,
  deleteChecklistItem: tasks.deleteChecklistItem,
  addComment: (taskId, body) => tasks.addComment(taskId, body),
  deleteComment: tasks.deleteComment,
  addAttachments: files.addAttachments,
  openAttachment: files.openAttachment,
  deleteAttachment: files.deleteAttachment,
  addDependency: tasks.addDependency,
  removeDependency: tasks.removeDependency,

  getRunningTimer: time.getRunningTimer,
  startTimer: time.startTimer,
  stopTimer: time.stopTimer,
  addTimeEntry: time.addTimeEntry,
  updateTimeEntry: time.updateTimeEntry,
  deleteTimeEntry: time.deleteTimeEntry,
  listTimeEntries: time.listTimeEntries,
  exportTimeCsv: files.exportTimeCsv,

  listGoals: () => planning.listGoals(),
  createGoal: planning.createGoal,
  updateGoal: planning.updateGoal,
  deleteGoal: planning.deleteGoal,
  addKeyResult: planning.addKeyResult,
  updateKeyResult: planning.updateKeyResult,
  deleteKeyResult: planning.deleteKeyResult,
  linkKeyResultTask: planning.linkKeyResultTask,
  unlinkKeyResultTask: planning.unlinkKeyResultTask,

  createSprint: planning.createSprint,
  updateSprint: planning.updateSprint,
  deleteSprint: planning.deleteSprint,
  completeSprint: planning.completeSprint,
  getSprintStats: planning.getSprintStats,

  listDashboards: dashboards.listDashboards,
  getDashboard: dashboards.getDashboard,
  createDashboard: dashboards.createDashboard,
  updateDashboard: dashboards.updateDashboard,
  deleteDashboard: dashboards.deleteDashboard,
  addWidget: dashboards.addWidget,
  updateWidget: dashboards.updateWidget,
  deleteWidget: dashboards.deleteWidget,
  reorderWidgets: dashboards.reorderWidgets,
  getWidgetData: dashboards.getWidgetData,

  listReminders: (opts) => notify.listReminders(opts),
  createReminder: notify.createReminder,
  updateReminder: notify.updateReminder,
  deleteReminder: notify.deleteReminder,
  listNotifications: notify.listNotifications,
  markNotificationsRead: notify.markNotificationsRead,
  clearNotifications: notify.clearNotifications,

  listAutomations: automation.listAutomations,
  createAutomation: automation.createAutomation,
  updateAutomation: automation.updateAutomation,
  deleteAutomation: automation.deleteAutomation,
  duplicateAutomation: automation.duplicateAutomation,
  listAutomationRuns: (id) => automation.listAutomationRuns(id),
  testAutomation: automation.testAutomation,
  runAutomationNow: automation.runAutomationNow,

  listAccounts: accounts.listAccounts,
  createAccount: accounts.createAccount,
  updateAccount: accounts.updateAccount,
  deleteAccount: accounts.deleteAccount,
  testAccount: async (input) => {
    if (input.kind === 'mail') return { ...(await accounts.testMailConnection(input)), caldav: null }
    const cfg = input.config as CalDavConfig
    try {
      const r = !input.password && input.accountId ? await calendar.testCalDavAccount(input.accountId) : await calendar.testCalDav(cfg, input.password ?? '')
      return { imap: null, smtp: null, caldav: r.calendars ? null : 'Connected, but no calendars were found at this address', calendars: r.calendars }
    } catch (e) {
      return { imap: null, smtp: null, caldav: friendlyMailError(e) }
    }
  },
  syncAccount: mail.syncAccountNow,
  syncAllAccounts: () => mail.syncAllAccounts(),

  listThreads: store.listThreads,
  getThread: store.getThread,
  getUnreadCount: store.unreadInboxCount,
  markThreadRead: accounts.markThreadRead,
  setThreadDone: accounts.setThreadDone,
  sendEmail: (input) => send.queueEmail(input),
  listOutbox: send.listOutbox,
  retryOutbox: send.retryOutbox,
  cancelOutbox: send.cancelOutbox,
  openMailAttachment: (id) => {
    const a = store.attachmentFile(id)
    if (!a) throw new Error('Attachment not found')
    if (!a.path) throw new Error('This attachment was too large to keep offline')
    files.openUntrustedFile(a.path, a.filename)
  },
  createTaskFromThread: (threadId, listId) => mail.createTaskFromThread(threadId, listId),
  linkThreadTask: mail.linkThreadTask,
  unlinkThreadTask: mail.unlinkThreadTask,
  listEmailTemplates: sequences.listTemplates,
  saveEmailTemplate: sequences.saveTemplate,
  deleteEmailTemplate: sequences.deleteTemplate,

  listSequences: sequences.listSequences,
  createSequence: sequences.createSequence,
  updateSequence: sequences.updateSequence,
  deleteSequence: sequences.deleteSequence,
  listEnrollments: (filter) => sequences.listEnrollments(filter),
  enrollThread: sequences.enrollThread,
  stopEnrollment: (id) => sequences.stopEnrollment(id),

  listCalendars: calendar.listCalendars,
  updateCalendar: calendar.updateCalendar,
  listEvents: calendar.listEvents,
  createEvent: calendar.createEvent,
  updateEvent: calendar.updateEvent,
  deleteEvent: calendar.deleteEvent,
  createEventForTask: calendar.createEventForTask,

  getAiKeyStatus: aiProviders.keyStatus,
  setAiKey: aiProviders.setAiKey,
  testAi: aiFeatures.aiTest,
  getAiUsage: aiFeatures.aiUsageSummary,
  listChats: assistant.listChats,
  getChat: assistant.getChat,
  sendChat: assistant.sendChat,
  resolveChatTools: assistant.resolveChatTools,
  stopChat: assistant.stopChat,
  deleteChat: assistant.deleteChat,
  aiSummarizeTask: aiFeatures.aiSummarizeTask,
  aiSuggestSubtasks: aiFeatures.aiSuggestSubtasks,
  aiRewrite: aiFeatures.aiRewrite,
  aiParseQuickAdd: aiFeatures.aiParseQuickAdd,
  aiWeeklyReview: aiFeatures.aiWeeklyReview,
  aiSummarizeThread: aiFeatures.aiSummarizeThread,
  aiDraftReply: aiFeatures.aiDraftReply,
  aiExtractTasks: aiFeatures.aiExtractTasks,
  aiTriageThread: aiFeatures.aiTriageThread,
  aiTriageInbox: () => aiFeatures.aiTriageInbox(),

  listIntegrations: integrations.listIntegrations,
  createIntegration: integrations.createIntegration,
  updateIntegration: integrations.updateIntegration,
  deleteIntegration: integrations.deleteIntegration,
  testIntegration: integrations.testIntegration,
  listSlackChannels: integrations.listSlackChannels,
  postToIntegration: integrations.postToIntegration,
  syncIntegration: integrations.pollSlack,

  getOAuthClients: oauth.getOAuthClients,
  setOAuthClient: oauth.setOAuthClient,
  signInWithProvider: (provider, reconnectId) => accounts.signInWithProvider(provider, reconnectId),
  cancelSignIn: oauth.cancelOAuth,

  getUpdateStatus: updater.getUpdateStatus,
  checkForUpdates: updater.checkForUpdates,
  installUpdate: () => updater.installUpdate(markQuitting),

  exportIcs: files.exportIcs,
  search: meta.search,
  getMyWork: tasks.getMyWork,
  getViewConfig: meta.getViewConfig,
  setViewConfig: meta.setViewConfig,
  getSettings: meta.getSettings,
  updateSettings: (patch) => {
    const feed = patch.updates?.feedUrl?.trim()
    // updates are executables: only fetch them over HTTPS (localhost allowed for testing)
    if (feed && !/^https:\/\//i.test(feed) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(feed.endsWith('/') ? feed : `${feed}/`))
      throw new Error('The update server must be an https:// address')
    const s = meta.updateSettings(patch)
    applySettings(s)
    return s
  },
  backupNow: files.backupNow,
  listBackups: files.listBackups,
  getDataPath: files.dataDir,
  openDataFolder: files.openDataFolder,
  exportJson: files.exportJson
}
