import { getGatewayManagerInstance } from '../../services/gateway-bootstrap'

interface FollowupMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
}

const DEFAULT_SUGGESTIONS = ['继续深入一下', '还有哪些注意点？', '下一步怎么做？']
const FOLLOWUP_REASONING_EFFORT = process.env.EKKO_FOLLOWUP_REASONING_EFFORT || 'xhigh'
const MAX_CONTEXT_MESSAGES = 6
const MAX_CONTENT_CHARS = 1600

const OPEN_WEBUI_FOLLOW_UP_PROMPT_TEMPLATE = `### Task:
Suggest 3-5 relevant follow-up questions or prompts that the user might naturally ask next in this conversation as a **user**, based on the chat history, to help continue or deepen the discussion.
### Guidelines:
- Write all follow-up questions from the user’s point of view, directed to the assistant.
- Make questions concise, clear, and directly related to the discussed topic(s).
- Only suggest follow-ups that make sense given the chat content and do not repeat what was already covered.
- If the conversation is very short or not specific, suggest more general (but relevant) follow-ups the user might ask.
- Use the conversation's primary language; default to English if multilingual.
- Response must be a JSON object with a "follow_ups" key containing an array of strings, no extra text or formatting.
### Output:
JSON format: { "follow_ups": ["Question 1?", "Question 2?", "Question 3?"] }
### Chat History:
<chat_history>
{{MESSAGES:END:6}}
</chat_history>`

function cleanSuggestion(value: unknown): string {
  return String(value || '')
    .replace(/^[-*\d.、\s]+/, '')
    .replace(/["'“”‘’]/g, '')
    .trim()
    .slice(0, 48)
}

function uniqShort(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const item = cleanSuggestion(raw)
    if (!item || item.length < 2 || seen.has(item)) continue
    seen.add(item)
    out.push(item)
    if (out.length >= 4) break
  }
  return out
}

function fallbackSuggestions(messages: FollowupMessage[]): string[] {
  const last = [...messages].reverse().find(m => m.role === 'assistant' && m.content?.trim())?.content || ''
  const text = last.toLowerCase()
  if (/error|failed|失败|报错|异常|不可用|401|403|404|500|timeout|超时/.test(text)) {
    return ['继续排查', '验证一下', '看日志', '给出修复方案']
  }
  if (/已完成|完成|ok|通过|成功|done|健康|running|online|在线/.test(text)) {
    return ['验证一下', '总结当前状态', '下一步怎么做']
  }
  if (/配置|服务|端口|网关|gateway|docker|ssh|openclaw|小赫|hermes/i.test(last)) {
    return ['继续执行', '检查状态', '列出风险', '总结当前状态']
  }
  return DEFAULT_SUGGESTIONS
}

function extractJsonArray(text: string): string[] {
  const trimmed = text.trim()
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return uniqShort(parsed)
    if (Array.isArray(parsed?.follow_ups)) return uniqShort(parsed.follow_ups)
    if (Array.isArray(parsed?.suggestions)) return uniqShort(parsed.suggestions)
  } catch { }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1])
      if (Array.isArray(parsed)) return uniqShort(parsed)
      if (Array.isArray(parsed?.follow_ups)) return uniqShort(parsed.follow_ups)
      if (Array.isArray(parsed?.suggestions)) return uniqShort(parsed.suggestions)
    } catch { }
  }
  return uniqShort(trimmed.split(/\n+/).map(line => line.replace(/^\s*[-*\d.、]+\s*/, '')))
}

function formatChatMessage(message: FollowupMessage): string {
  const role = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : message.role
  return `<message role="${role}">\n${message.content.slice(0, MAX_CONTENT_CHARS)}\n</message>`
}

function fillOpenWebuiMessages(template: string, messages: FollowupMessage[]): string {
  const eligible = messages.filter(m => (m.role === 'user' || m.role === 'assistant') && m.content?.trim())
  const tail = eligible.slice(-MAX_CONTEXT_MESSAGES).map(formatChatMessage).join('\n')
  return template.replace('{{MESSAGES:END:6}}', tail)
}

function buildPrompt(messages: FollowupMessage[]): string {
  return fillOpenWebuiMessages(OPEN_WEBUI_FOLLOW_UP_PROMPT_TEMPLATE, messages)
}

async function callFastModel(messages: FollowupMessage[], profile?: string): Promise<string[]> {
  const mgr = getGatewayManagerInstance()
  const upstream = mgr?.getUpstream(profile || 'default')?.replace(/\/$/, '')
  if (!upstream) return []
  const apiKey = mgr?.getApiKeyForUpstream(profile || 'default') || undefined
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const res = await fetch(`${upstream}/v1/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'gpt-5.4-mini',
      input: buildPrompt(messages),
      instructions: 'Return only a JSON object with a "follow_ups" key containing an array of strings. No extra text or formatting.',
      stream: false,
      store: false,
      max_output_tokens: 160,
      reasoning: { enabled: true, effort: FOLLOWUP_REASONING_EFFORT },
    }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) return []
  const data = await res.json() as any
  const output = data.output_text
    || data.text
    || data.response?.output_text
    || data.output?.flatMap?.((item: any) => item.content || [])?.map?.((c: any) => c.text || c.output_text || '').join('')
    || ''
  return extractJsonArray(String(output))
}

export async function generateFollowups(ctx: any) {
  const body = ctx.request.body || {}
  const messages = Array.isArray(body.messages) ? body.messages as FollowupMessage[] : []
  const profile = typeof body.profile === 'string' ? body.profile : undefined
  if (!messages.length) {
    ctx.body = { suggestions: DEFAULT_SUGGESTIONS, source: 'fallback' }
    return
  }

  try {
    const modelSuggestions = await callFastModel(messages, profile)
    if (modelSuggestions.length) {
      ctx.body = { suggestions: modelSuggestions, source: 'model' }
      return
    }
  } catch { }

  ctx.body = { suggestions: fallbackSuggestions(messages), source: 'fallback' }
}
