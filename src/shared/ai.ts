export type AiProviderId = 'anthropic' | 'openai' | 'ollama'

export const ANTHROPIC_MODELS: { id: string; label: string; inPerM: number; outPerM: number }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (recommended)', inPerM: 4, outPerM: 20 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)', inPerM: 2, outPerM: 10 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)', inPerM: 0.1, outPerM: 0.5 },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (most capable, most expensive)', inPerM: 10, outPerM: 50 }
]

export interface AiSettings {
  provider: AiProviderId
  anthropicModel: string
  openaiModel: string
  ollamaModel: string
  ollamaUrl: string
  /** reasoning effort for chat and writing features (triage/parsing always use low) */
  effort: 'low' | 'medium' | 'high'
  /** classify new inbound email automatically (sends each new email to the AI provider) */
  autoTriage: boolean
}

/** What the renderer is told about API keys: never the keys themselves. */
export interface AiKeyStatus {
  anthropic: boolean
  openai: boolean
}

// ---------------------------------------------------------------- assistant chat

export type ToolCallStatus = 'pending' | 'approved' | 'declined' | 'running' | 'done' | 'error'

export interface ChatToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  /** write actions wait for the user's approval */
  needsApproval: boolean
  status: ToolCallStatus
  /** plain-English description shown on the approval card */
  summary: string
  result?: string
}

export interface ChatMessageView {
  id: string
  role: 'user' | 'assistant'
  text: string
  toolCalls: ChatToolCall[]
  /** refusal / truncation / error notes */
  notice?: string
  created_at: string
}

export type ChatStatus = 'idle' | 'running' | 'awaiting_approval' | 'error'

export interface ChatConversation {
  id: string
  title: string
  provider: AiProviderId
  model: string
  status: ChatStatus
  error: string | null
  updated_at: string
}

export interface ChatDetail extends ChatConversation {
  messages: ChatMessageView[]
}

/** Pushed from main to the renderer while the assistant works. */
export type AiEvent = { kind: 'delta'; conversationId: string; text: string } | { kind: 'changed'; conversationId: string }

// ---------------------------------------------------------------- inline features

export type EmailCategory = 'action' | 'reply' | 'fyi' | 'newsletter' | 'notification' | 'spam'

export const EMAIL_CATEGORY_LABEL: Record<EmailCategory, string> = {
  action: 'Needs action',
  reply: 'Needs reply',
  fyi: 'FYI',
  newsletter: 'Newsletter',
  notification: 'Notification',
  spam: 'Likely spam'
}

export interface TriageResult {
  category: EmailCategory
  /** 1 = high, 2 = normal, 3 = low */
  priority: 1 | 2 | 3
  summary: string
}

export interface ParsedQuickAdd {
  title: string
  due_date: string | null
  priority: 'urgent' | 'high' | 'normal' | 'low' | 'none'
  tags: string[]
}

export interface AiUsageSummary {
  month: string
  input_tokens: number
  output_tokens: number
  /** USD estimate for Anthropic models; null when only other providers were used */
  estimated_cost: number | null
  by_feature: { feature: string; calls: number }[]
}

export type RewriteStyle = 'clearer' | 'shorter' | 'friendlier' | 'formal' | 'fix_grammar'
