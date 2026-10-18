import { useState } from 'react'
import { CheckCircle2, KeyRound, Loader2, XCircle } from 'lucide-react'
import { ANTHROPIC_MODELS, type AiProviderId, type AiSettings } from '@shared/ai'
import { api } from '@/lib/api'
import { useAiKeyStatus, useAiUsage, useSettings } from '@/lib/hooks'
import { toast } from '@/stores/ui'
import { Button, Input, Segmented, Toggle } from '@/components/ui'

const FEATURE_LABEL: Record<string, string> = {
  chat: 'Assistant chat',
  triage: 'Email triage',
  task_summary: 'Task summaries',
  subtasks: 'Subtask suggestions',
  rewrite: 'Rewriting',
  quick_add: 'Quick add parsing',
  weekly_review: 'Weekly review',
  email_summary: 'Email summaries',
  email_draft: 'Reply drafts',
  email_tasks: 'Task extraction',
  automation: 'Automations',
  test: 'Connection tests'
}

const selectCls = 'h-8 rounded-md border border-line bg-panel px-2 text-[13px]'

function KeyField({ provider, saved }: { provider: 'anthropic' | 'openai'; saved: boolean }) {
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(false)
  const save = async () => {
    await api.setAiKey(provider, value.trim())
    setValue('')
    setEditing(false)
    toast('API key saved', 'success')
  }
  if (saved && !editing)
    return (
      <div className="flex items-center gap-2">
        <span className="flex flex-1 items-center gap-1.5 text-[13px] text-emerald-600">
          <KeyRound size={14} /> Key saved (encrypted on this PC)
        </span>
        <Button size="sm" onClick={() => setEditing(true)}>Replace</Button>
        <Button size="sm" onClick={() => window.confirm('Remove the saved API key?') && api.setAiKey(provider, null)}>Remove</Button>
      </div>
    )
  return (
    <div className="flex gap-2">
      <Input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && value.trim() && void save()}
        placeholder={provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
        aria-label={`${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key`}
      />
      <Button variant="primary" disabled={!value.trim()} onClick={save}>Save key</Button>
      {editing && <Button onClick={() => (setEditing(false), setValue(''))}>Cancel</Button>}
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      {children}
    </div>
  )
}

export function AiSection() {
  const { data: settings } = useSettings()
  const { data: keys } = useAiKeyStatus()
  const { data: usage } = useAiUsage()
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  if (!settings || !keys) return null
  const ai = settings.ai
  const set = (patch: Partial<AiSettings>) => {
    setResult(null)
    return api.updateSettings({ ai: { ...ai, ...patch } })
  }
  const ready = ai.provider === 'ollama' || keys[ai.provider]

  return (
    <div className="space-y-4">
      <Row label="Provider">
        <Segmented<AiProviderId>
          value={ai.provider}
          options={[['anthropic', 'Claude'], ['openai', 'OpenAI'], ['ollama', 'Local (Ollama)']]}
          onChange={(provider) => set({ provider })}
        />
      </Row>

      {ai.provider === 'anthropic' && (
        <>
          <Row label="Model">
            <select value={ai.anthropicModel} onChange={(e) => set({ anthropicModel: e.target.value })} className={selectCls} aria-label="Claude model">
              {ANTHROPIC_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
              {!ANTHROPIC_MODELS.some((m) => m.id === ai.anthropicModel) && <option value={ai.anthropicModel}>{ai.anthropicModel}</option>}
            </select>
          </Row>
          <div>
            <div className="mb-1.5">Anthropic API key</div>
            <KeyField provider="anthropic" saved={keys.anthropic} />
            <p className="mt-1 text-xs text-muted">Create one at console.anthropic.com → API keys. Usage is billed to your Anthropic account.</p>
          </div>
          <Row label="Thinking effort" hint="Higher gives better answers in chat and writing, but is slower and costs more.">
            <select value={ai.effort} onChange={(e) => set({ effort: e.target.value as AiSettings['effort'] })} className={selectCls} aria-label="Thinking effort">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Row>
        </>
      )}

      {ai.provider === 'openai' && (
        <>
          <Row label="Model">
            <Input className="w-48" defaultValue={ai.openaiModel} onBlur={(e) => e.target.value.trim() && e.target.value !== ai.openaiModel && set({ openaiModel: e.target.value.trim() })} aria-label="OpenAI model" />
          </Row>
          <div>
            <div className="mb-1.5">OpenAI API key</div>
            <KeyField provider="openai" saved={keys.openai} />
          </div>
        </>
      )}

      {ai.provider === 'ollama' && (
        <>
          <Row label="Server address" hint="Ollama must be running on this PC or your network.">
            <Input className="w-64" defaultValue={ai.ollamaUrl} onBlur={(e) => e.target.value.trim() && e.target.value !== ai.ollamaUrl && set({ ollamaUrl: e.target.value.trim() })} aria-label="Ollama URL" />
          </Row>
          <Row label="Model" hint="A model you have pulled, e.g. llama3.1 or qwen2.5. Tool use needs a model that supports it.">
            <Input className="w-48" defaultValue={ai.ollamaModel} onBlur={(e) => e.target.value.trim() && e.target.value !== ai.ollamaModel && set({ ollamaModel: e.target.value.trim() })} aria-label="Ollama model" />
          </Row>
        </>
      )}

      <div className="flex items-center gap-3">
        <Button
          disabled={!ready || testing}
          onClick={async () => {
            setTesting(true)
            setResult(null)
            try {
              setResult(await api.testAi())
            } finally {
              setTesting(false)
            }
          }}
        >
          {testing && <Loader2 size={14} className="animate-spin" />} Test connection
        </Button>
        {result && (
          <span className={`flex items-center gap-1.5 text-[13px] ${result.ok ? 'text-emerald-600' : 'text-danger'}`}>
            {result.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {result.message}
          </span>
        )}
      </div>

      <div className="border-t border-line pt-4">
        <Toggle
          label="Sort new email automatically"
          hint="Each new inbox email is sent to the AI provider and labelled Needs action, Needs reply, FYI, Newsletter, Notification or Likely spam. Labels can trigger automations."
          checked={ai.autoTriage}
          onChange={(autoTriage) => set({ autoTriage })}
        />
        <Button
          size="sm"
          className="mt-2 ml-12"
          disabled={!ready}
          onClick={async () => {
            const n = await api.aiTriageInbox()
            toast(n ? `Sorting ${n} email${n === 1 ? '' : 's'}…` : 'Everything in the inbox is already sorted', 'success')
          }}
        >
          Sort current inbox now
        </Button>
      </div>

      {usage && (
        <div className="border-t border-line pt-4">
          <div className="flex items-baseline justify-between">
            <span>Usage this month</span>
            <span className="text-[13px]">
              {usage.estimated_cost !== null && <strong className="mr-2">≈ ${usage.estimated_cost.toFixed(2)}</strong>}
              <span className="text-muted">
                {fmtTokens(usage.input_tokens)} in · {fmtTokens(usage.output_tokens)} out
              </span>
            </span>
          </div>
          {usage.by_feature.length > 0 ? (
            <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-muted">
              {usage.by_feature.map((f) => (
                <li key={f.feature} className="flex justify-between">
                  <span>{FEATURE_LABEL[f.feature] ?? f.feature}</span>
                  <span>{f.calls} call{f.calls === 1 ? '' : 's'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted">No AI requests yet this month.</p>
          )}
          <p className="mt-2 text-xs text-muted">Cost is an estimate from list prices for Claude models; check your provider’s billing page for exact charges.</p>
        </div>
      )}
    </div>
  )
}

const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
