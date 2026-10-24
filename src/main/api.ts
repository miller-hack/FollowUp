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
import * as templates from './services/mail/templates'
import * as followups from './services/mail/followups'
import * as folders from './services/mail/folders'
import { draftFollowUp } from './services/mail/followupDraft'
import * as drafts from './services/mail/drafts'
import * as crm from './services/crm'
import { runImport } from './services/crmio'
import * as store from './services/mail/store'
import { detectMailSettings } from './services/mail/detect'
import { friendlyMailError } from './services/mail/transport'
import type { CalDavConfig } from '@shared/mail'
import { applySettings, markQuitting } from './desktop'

/** Main-process implementation of the IPC contract. */
function validateFollowUpSettings(f: Partial<import('@shared/mail').FollowUpSettings>): void {
  if (f.replyAfterHours !== undefined && !(f.replyAfterHours >= 1 && f.replyAfterHours <= 24 * 30)) throw new Error('Choose between 1 hour and 30 days for “reply needed”')
  if (f.nudgeAfterHours !== undefined && !(f.nudgeAfterHours >= 1 && f.nudgeAfterHours <= 24 * 30)) throw new Error('Choose between 1 hour and 30 days for “waiting on them”')
  if (f.workingDays !== undefined && (!Array.isArray(f.workingDays) || f.workingDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)))
    throw new Error('Choose the working days')
  if (f.companyDomains?.some((d) => !/^@?[a-z0-9-]+(.[a-z0-9-]+)+$/i.test(d.trim()))) throw new Error('Enter company domains like acme.com')
}

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
  // a mailbox address counts as "us" for Follow-up: recompute when the set changes
  createAccount: (input) => {
    const a = accounts.createAccount(input)
    followups.recomputeFollowUps()
    return a
  },
  updateAccount: accounts.updateAccount,
  deleteAccount: (id) => {
    accounts.deleteAccount(id)
    followups.recomputeFollowUps()
  },
  getMailSettingsFor: (email) => detectMailSettings(email),
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
  sendEmail: (input) => {
    const o = send.queueEmail(input)
    if (input.draft_id) drafts.discardDraft(input.draft_id)
    return o
  },
  saveDraft: (input, replaces) => drafts.saveDraft(input, replaces ?? null),
  discardDraft: drafts.discardDraft,
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
  listEmailTemplates: templates.listTemplates,
  saveEmailTemplate: templates.saveTemplate,
  deleteEmailTemplate: templates.deleteTemplate,

  listMailFolders: (accountId) => folders.listMailFolders(accountId ?? null),
  moveThread: folders.moveThread,
  deleteThreadForever: folders.deleteThreadForever,

  getFollowUpCounts: () => followups.followUpCounts(),
  getFollowUpDraft: (threadId, instructions) => draftFollowUp(threadId, instructions ?? ''),
  snoozeFollowUp: followups.snoozeFollowUp,
  dismissFollowUp: followups.dismissFollowUp,
  restoreFollowUp: followups.restoreFollowUp,

  listClients: (filter) => crm.listClients(filter ?? {}),
  getClientTimeline: (companyId, personId) => crm.clientTimeline(companyId, personId ?? null),
  listCrmStages: crm.listStages,
  saveCrmStages: crm.saveStages,
  listTeam: crm.listTeam,
  saveTeamMember: crm.saveTeamMember,
  deleteTeamMember: crm.deleteTeamMember,
  createCompany: crm.createCompany,
  updateCompany: crm.updateCompany,
  deleteCompany: crm.deleteCompany,
  createPerson: crm.createPerson,
  updatePerson: crm.updatePerson,
  deletePerson: crm.deletePerson,
  logInteraction: crm.logInteraction,
  updateInteraction: crm.updateInteraction,
  deleteInteraction: crm.deleteInteraction,
  listClientSuggestions: () => crm.clientSuggestions(),
  addClientSuggestion: crm.addSuggestion,
  ignoreClientSuggestion: crm.ignoreSuggestion,
  chooseClientImport: files.chooseClientImport,
  runClientImport: runImport,
  exportClients: files.exportClients,
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
    if (patch.followups) validateFollowUpSettings(patch.followups)
    const s = meta.updateSettings(patch)
    applySettings(s)
    // new company domains, working days or waiting times change what needs follow-up
    if (patch.followups) followups.recomputeFollowUps()
    return s
  },
  setUiWidth: (key, width) => {
    if (!/^[w:.-]{1,80}$/.test(key)) throw new Error('Invalid layout key')
    const widths = { ...meta.getSettings().ui.widths }
    if (width === null) delete widths[key]
    else if (Number.isFinite(width) && width >= 40 && width <= 4000) widths[key] = Math.round(width)
    else throw new Error('Invalid width')
    meta.updateSettings({ ui: { widths } })
  },
  backupNow: files.backupNow,
  listBackups: files.listBackups,
  getDataPath: files.dataDir,
  openDataFolder: files.openDataFolder,
  exportJson: files.exportJson
}
