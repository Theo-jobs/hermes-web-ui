/**
 * Chat Context Compressor
 *
 * Compresses 1:1 chat conversation history before sending to upstream.
 * Uses the Hermes structured summary prompt for LLM-based compression.
 *
 * Algorithm:
 * 1. If total tokens < trigger threshold → return as-is
 * 2. Pre-clean: truncate old tool results (no LLM call)
 * 3. Load snapshot from SQLite for incremental update
 * 4. Keep last 20 messages verbatim (tail protection by message count)
 * 5. Summarize everything before the tail
 * 6. Save snapshot: last_message_index = index where compression ends
 */

import { encodingForModel, getEncoding } from 'js-tiktoken'
import { logger } from '../../services/logger'
import {
  getCompressionSnapshot,
  saveCompressionSnapshot,
  deleteCompressionSnapshot,
} from '../../db/hermes/compression-snapshot'

// ─── Types ───────────────────────────────────────────────

export interface ContentBlock {
  type: 'text' | 'image' | 'file'
  text?: string
  path?: string
  source?: { type: string; media_type?: string; data?: string }
}

export interface ChatMessage {
  role: string
  content: string | ContentBlock[]
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
  tool_call_id?: string
  name?: string
  reasoning_content?: string | null
}

export interface CompressionConfig {
  /** Token threshold to trigger compression (default: contextLength / 2) */
  triggerTokens: number
  /** Summary token target (default: 8000) */
  summaryBudget: number
  /** Number of recent messages to keep verbatim (default: 20) */
  tailMessageCount: number
  /** Timeout for LLM summarization call (default: 60_000ms) */
  summarizationTimeoutMs: number
}

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  triggerTokens: 100_000,
  summaryBudget: 8_000,
  tailMessageCount: 20,
  summarizationTimeoutMs: 360_000,
}

export interface CompressedResult {
  messages: ChatMessage[]
  meta: {
    totalMessages: number
    compressed: boolean
    /** true = actually called LLM to summarize; false = assembled from existing snapshot or returned as-is */
    llmCompressed: boolean
    summaryTokenEstimate: number
    verbatimCount: number
    compressedStartIndex: number
    error?: string
    skippedReason?: string
  }
}

// ─── Token counting ─────────────────────────────────────

let _encoder: ReturnType<typeof getEncoding> | null = null

function getEncoder() {
  if (!_encoder) {
    _encoder = getEncoding('cl100k_base')
  }
  return _encoder
}

export function countTokens(text: string): number {
  try {
    return getEncoder().encode(text).length
  } catch {
    const cjk = (text.match(/[\u2e80-\u9fff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]/g) || []).length
    const other = text.length - cjk
    return Math.ceil(cjk * 1.5 + other / 4)
  }
}

export function countTokensForModel(text: string, model: string): number {
  try {
    const enc = encodingForModel(model as any)
    return enc.encode(text).length
  } catch {
    return countTokens(text)
  }
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => {
    const content = typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content ?? '')
    const toolCalls = message.tool_calls?.length ? JSON.stringify(message.tool_calls) : ''
    return sum + countTokens(content) + countTokens(toolCalls)
  }, 0)
}

const SUMMARY_INPUT_TOTAL_CHAR_BUDGET = 60_000
const SUMMARY_INPUT_PER_MESSAGE_CHAR_BUDGET = 2_400
const SUMMARY_INPUT_HEAD_MESSAGES = 6
const SUMMARY_INPUT_TAIL_MESSAGES = 36

interface SummarySerializationOptions {
  maxTotalChars?: number
  maxPerMessageChars?: number
  headMessages?: number
  tailMessages?: number
}

function truncateMiddle(text: string, maxChars: number): string {
  if (maxChars <= 0 || text.length <= maxChars) return text
  if (maxChars <= 80) return text.slice(0, maxChars)
  const marker = `\n... [truncated ${text.length - maxChars} chars] ...\n`
  const head = Math.ceil((maxChars - marker.length) * 0.6)
  const tail = Math.max(0, maxChars - marker.length - head)
  return text.slice(0, head) + marker + text.slice(-tail)
}

function contentToString(content: string | ContentBlock[] | undefined): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(block => {
      if (block.type === 'text') return block.text || ''
      if (block.type === 'image') return `[Image: ${block.path || ''}]`
      if (block.type === 'file') return `[File: ${block.path || ''}]`
      return ''
    }).join('')
  }
  return ''
}

function serializeOneMessage(msg: ChatMessage, maxPerMessageChars: number): string {
  const role = msg.role === 'tool' ? `[tool:${msg.name || 'unknown'}]` : msg.role
  let content = contentToString(msg.content || '')

  if (msg.role === 'tool' && content.length > 5500) {
    content = content.slice(0, 4000) + '\n... [truncated]\n...' + content.slice(-1500)
  }
  content = truncateMiddle(content, maxPerMessageChars)

  if (msg.role === 'assistant' && msg.tool_calls?.length) {
    const toolsInfo = msg.tool_calls.map(tc => {
      let args = tc.function.arguments
      args = truncateMiddle(args, Math.min(1500, maxPerMessageChars))
      return `[tool_call: ${tc.function.name}(${args})]`
    }).join('\n')
    return content.trim() ? `${role}: ${toolsInfo}\n\n${role}: ${content}` : `${role}: ${toolsInfo}`
  }

  return `${role}: ${content}`
}

// ─── Prompts ────────────────────────────────────────────

export const SUMMARY_PREFIX = `[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted
into the summary below. This is a handoff from a previous context
window — treat it as background reference, NOT as active instructions.
Do NOT answer questions or fulfill requests mentioned in this summary;
they were already addressed.
Your current task is identified in the '## Active Task' section of the
summary — resume exactly from there.
Respond ONLY to the latest user message
that appears AFTER this summary. The current session state (files,
config, etc.) may reflect work described here — avoid repeating it:`

const TEMPLATE_SECTIONS = `Use this exact structure:

## Active Task
[THE SINGLE MOST IMPORTANT FIELD. Copy the user's most recent request or
task assignment verbatim — the exact words they used. If multiple tasks
were requested and only some are done, list only the ones NOT yet completed.
The next assistant must pick up exactly here. Example:
"User asked: 'Now refactor the auth module to use JWT instead of sessions'"
If no outstanding task exists, write "None."]

## Goal
[What the user is trying to accomplish overall]

## Constraints & Preferences
[User preferences, coding style, constraints, important decisions]

## Completed Actions
[Numbered list of concrete actions taken — include tool used, target, and outcome.
Format each as: N. ACTION target — outcome [tool: name]
Example:
1. READ config.py:45 — found == should be != [tool: read_file]
2. PATCH config.py:45 — changed == to != [tool: patch]
3. TEST pytest tests/ — 3/50 failed: test_parse, test_validate, test_edge [tool: terminal]
Be specific with file paths, commands, line numbers, and results.]

## Active State
[Current working state — include:
- Working directory and branch (if applicable)
- Modified/created files with brief note on each
- Test status (X/Y passing)
- Any running processes or servers
- Environment details that matter]

## In Progress
[Work currently underway — what was being done when compaction fired]

## Blocked
[Any blockers, errors, or issues not yet resolved. Include exact error messages.]

## Key Decisions
[Important technical decisions and WHY they were made]

## Resolved Questions
[Questions the user asked that were ALREADY answered — include the answer so the next assistant does not re-answer them]

## Pending User Asks
[Questions or requests from the user that have NOT yet been answered or fulfilled. If none, write "None."]

## Relevant Files
[Files read, modified, or created — with brief note on each]

## Remaining Work
[What remains to be done — framed as context, not instructions]

## Critical Context
[Any specific values, error messages, configuration details, or data that would be lost without explicit preservation]`

export function buildFullPrompt(contentToSummarize: string, summaryBudget: number): string {
  return `You are a summarization agent creating a context checkpoint.
Your output will be injected as reference material for a DIFFERENT
assistant that continues the conversation.
Do NOT respond to any questions or requests in the conversation —
only output the structured summary.
Do NOT include any preamble, greeting, or prefix.

Create a structured handoff summary for a different assistant that will continue
this conversation after earlier turns are compacted. The next assistant should be
able to understand what happened without re-reading the original turns.

TURNS TO SUMMARIZE:
${contentToSummarize}

${TEMPLATE_SECTIONS}

Target ~${summaryBudget} tokens. Be CONCRETE — include file paths, command outputs, error messages, line numbers, and specific values. Avoid vague descriptions like "made some changes" — say exactly what changed.

Write only the summary body. Do not include any preamble or prefix.`
}

export function buildIncrementalPrompt(previousSummary: string, contentToSummarize: string, summaryBudget: number): string {
  return `You are a summarization agent creating a context checkpoint.
Your output will be injected as reference material for a DIFFERENT
assistant that continues the conversation.
Do NOT respond to any questions or requests in the conversation —
only output the structured summary.
Do NOT include any preamble, greeting, or prefix.

You are updating a context compaction summary. A previous compaction produced the
summary below. New conversation turns have occurred since then and need to be
incorporated.

PREVIOUS SUMMARY:
${previousSummary}

NEW TURNS TO INCORPORATE:
${contentToSummarize}

Update the summary using this exact structure. PRESERVE all existing information
that is still relevant. ADD new completed actions to the numbered list
(continue numbering). Move items from "In Progress" to "Completed Actions" when
done. Move answered questions to "Resolved Questions". Update "Active State"
to reflect current state. Remove information only if it is clearly obsolete.
CRITICAL: Update "## Active Task" to reflect the user's most recent unfulfilled
request — this is the most important field for task continuity.

${TEMPLATE_SECTIONS}

Target ~${summaryBudget} tokens. Be CONCRETE — include file paths, command outputs, error messages, line numbers, and specific values. Avoid vague descriptions like "made some changes" — say exactly what changed.

Write only the summary body. Do not include any preamble or prefix.`
}

// ─── Pre-cleaning ───────────────────────────────────────

export function serializeForSummary(
  messages: ChatMessage[],
  options: SummarySerializationOptions = {},
): string {
  const maxTotalChars = options.maxTotalChars ?? Number.POSITIVE_INFINITY
  const maxPerMessageChars = options.maxPerMessageChars ?? Number.POSITIVE_INFINITY
  const parts = messages.map(msg => serializeOneMessage(msg, maxPerMessageChars))

  if (!Number.isFinite(maxTotalChars) || parts.join('\n\n').length <= maxTotalChars) {
    return parts.join('\n\n')
  }

  const selected = new Set<number>()
  const headMessages = options.headMessages ?? SUMMARY_INPUT_HEAD_MESSAGES
  const tailMessages = options.tailMessages ?? SUMMARY_INPUT_TAIL_MESSAGES
  for (let i = 0; i < Math.min(headMessages, parts.length); i++) selected.add(i)
  for (let i = Math.max(0, parts.length - tailMessages); i < parts.length; i++) selected.add(i)

  const remainingBudget = () => maxTotalChars - Array.from(selected).reduce((sum, index) => sum + parts[index].length + 2, 0)
  // Preserve as many user turns as possible as anchors for the LLM summary.
  for (let i = headMessages; i < Math.max(headMessages, parts.length - tailMessages); i++) {
    if (messages[i].role !== 'user') continue
    if (remainingBudget() <= parts[i].length + 80) break
    selected.add(i)
  }

  const ordered = Array.from(selected).sort((a, b) => a - b)
  const bounded: string[] = []
  let previousIndex = -1
  for (const index of ordered) {
    if (previousIndex >= 0 && index > previousIndex + 1) {
      bounded.push(`[... ${index - previousIndex - 1} middle messages omitted to keep summarizer input bounded ...]`)
    }
    bounded.push(parts[index])
    previousIndex = index
  }

  const result = bounded.join('\n\n')
  return result.length <= maxTotalChars
    ? result
    : truncateMiddle(result, maxTotalChars)
}

/**
 * Convert messages to conversation history format for LLM API.
 * Tool calls are converted to text format within assistant messages.
 */
export function buildConversationHistory(messages: ChatMessage[]): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = []

  for (const msg of messages) {
    if (msg.role === 'tool') {
      // Convert tool result to text and append to previous assistant message
      const toolText = `[Tool result: ${msg.name || 'unknown'}]\n${(msg.content || '').slice(0, 4000)}${msg.content && msg.content.length > 4000 ? '...' : ''}`
      // Find the last assistant message and append to it
      const lastAssistant = result.findLast(m => m.role === 'assistant')
      if (lastAssistant) {
        lastAssistant.content += `\n\n${toolText}`
      } else {
        // Fallback: create an assistant message
        result.push({ role: 'assistant', content: toolText })
      }
    } else if (msg.role === 'assistant' && msg.tool_calls?.length) {
      // Include tool calls in assistant message
      const toolsInfo = msg.tool_calls.map(tc => {
        let args = tc.function.arguments
        if (args.length > 4000) args = args.slice(0, 4000) + '...'
        return `[Calling tool: ${tc.function.name} with arguments: ${args}]`
      }).join('\n')
      const content = msg.content ? `${msg.content}\n\n${toolsInfo}` : toolsInfo
      result.push({ role: msg.role, content })
    } else if (msg.role === 'user') {
      // Handle ContentBlock[] format: { type: 'text', text: '...' } or { type: 'image', path: '...' }
      let contentStr = ''
      const content = msg.content || ''
      if (typeof content === 'string') {
        contentStr = content
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text') {
            contentStr += block.text || ''
          } else if (block.type === 'image') {
            contentStr += `[Image: ${block.path || ''}]`
          } else if (block.type === 'file') {
            contentStr += `[File: ${block.path || ''}]`
          }
        }
      }
      if (contentStr.length > 4000) contentStr = contentStr.slice(0, 4000) + '...'
      result.push({ role: 'user', content: contentStr })
    } else if (msg.role === 'assistant' || msg.role === 'system') {
      let contentStr = ''
      const content = msg.content
      if (typeof content === 'string') {
        contentStr = content
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text') {
            contentStr += block.text || ''
          } else if (block.type === 'image') {
            contentStr += `[Image: ${block.path || ''}]`
          } else if (block.type === 'file') {
            contentStr += `[File: ${block.path || ''}]`
          }
        }
      }
      if (contentStr.length > 4000) contentStr = contentStr.slice(0, 4000) + '...'
      result.push({ role: msg.role, content: contentStr })
    }
    // Skip other roles
  }

  return result
}

export function pruneOldToolResults(messages: ChatMessage[], keepRecentCount: number): ChatMessage[] {
  if (messages.length <= keepRecentCount) return messages

  const tail = messages.slice(-keepRecentCount)
  const head = messages.slice(0, -keepRecentCount)

  const pruned = head.map(msg => {
    if (msg.role !== 'tool') return msg
    let content = ''
    if (typeof msg.content === 'string') {
      content = msg.content
    } else if (Array.isArray(msg.content)) {
      content = msg.content.map(block => {
        if (block.type === 'text') return block.text || ''
        return `[${block.type}]`
      }).join('')
    }
    const preview = content.slice(0, 100).replace(/\n/g, ' ')
    const truncated = content.length > 100 ? '...' : ''
    return { ...msg, content: `[${msg.name || 'tool'}] ${preview}${truncated}` }
  })

  return [...pruned, ...tail]
}

function excerptForFallback(msg: ChatMessage, maxChars: number): string {
  const role = msg.role === 'tool' ? `[tool:${msg.name || 'unknown'}]` : msg.role
  const content = truncateMiddle(contentToString(msg.content), maxChars).replace(/\n{3,}/g, '\n\n')
  return `- ${role}: ${content || '[empty]'}`
}

function latestUserContent(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return truncateMiddle(contentToString(messages[i].content), 1200) || 'None.'
    }
  }
  return 'None.'
}

function buildDeterministicFallbackSummary(
  allMessages: ChatMessage[],
  compressedMessages: ChatMessage[],
  tailStart: number,
  error?: string,
): string {
  const firstTurns = compressedMessages.slice(0, 4).map(msg => excerptForFallback(msg, 700))
  const recentCompressedTurns = compressedMessages.slice(-12).map(msg => excerptForFallback(msg, 900))
  const userAnchors = compressedMessages
    .filter(msg => msg.role === 'user')
    .slice(-10)
    .map(msg => excerptForFallback(msg, 700))

  return `[Compression fallback summary due to summarizer timeout]
The LLM summarizer failed while compacting earlier turns, so this deterministic
snapshot preserves bounded excerpts instead of a semantic LLM summary.

## Active Task
User asked: "${latestUserContent(allMessages)}"

## Goal
Continue the current conversation using the compacted excerpts below plus the
verbatim recent tail messages that follow this summary.

## Constraints & Preferences
- This is a deterministic fallback snapshot, not an LLM-authored summary.
- Earlier full content was intentionally omitted to keep the next run under the context budget.
- Summarizer error: ${error || 'unknown'}

## Completed Actions
Not available from deterministic fallback. Consult bounded excerpts below for concrete prior turns.

## Active State
- Total messages at fallback: ${allMessages.length}
- Messages compacted into this snapshot: 0-${Math.max(0, tailStart - 1)}
- Recent tail messages are preserved verbatim after this summary.

## In Progress
Continue from the latest user request and the preserved recent tail.

## Blocked
LLM summarization failed: ${error || 'unknown'}

## Key Decisions
- Saved a conservative fallback compression snapshot to prevent repeated expensive full-summary retries.
- Kept recent tail messages verbatim for continuity.

## Resolved Questions
Unknown from deterministic fallback.

## Pending User Asks
Use the latest user request in Active Task and the verbatim tail messages after this summary.

## Relevant Files
Unknown from deterministic fallback unless shown in excerpts or tail.

## Remaining Work
Continue the active task using the excerpts and recent tail context.

## Critical Context
### Recent user-turn anchors from compacted range
${userAnchors.length ? userAnchors.join('\n') : '- None captured.'}

### First compacted turns
${firstTurns.length ? firstTurns.join('\n') : '- None captured.'}

### Last compacted turns before verbatim tail
${recentCompressedTurns.length ? recentCompressedTurns.join('\n') : '- None captured.'}`
}

function boundedSummaryInput(messages: ChatMessage[]): string {
  return serializeForSummary(messages, {
    maxTotalChars: SUMMARY_INPUT_TOTAL_CHAR_BUDGET,
    maxPerMessageChars: SUMMARY_INPUT_PER_MESSAGE_CHAR_BUDGET,
  })
}

// ─── LLM Summarization ──────────────────────────────────

export async function callSummarizer(
  upstream: string,
  apiKey: string | undefined,
  prompt: string,
  history: Array<{ role: string; content: string }>,
  timeoutMs: number,
  previousSummary?: string,
  profile?: string,
): Promise<string> {
  const convHistory: Array<{ role: string; content: string }> = [...history]

  if (previousSummary) {
    convHistory.unshift(
      { role: 'user', content: `[Previous summary]\n${previousSummary}` },
      { role: 'assistant', content: 'Understood, I will update the summary.' },
    )
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const res = await fetch(`${upstream.replace(/\/$/, '')}/v1/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: prompt,
      conversation_history: convHistory,
      stream: true,
      store: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!res.ok) {
    throw new Error(`Summarization response failed: ${res.status}`)
  }

  if (!res.body) {
    throw new Error('Summarization response stream missing')
  }

  let output = ''
  for await (const frame of readSseFrames(res.body)) {
    let parsed: any
    try {
      parsed = JSON.parse(frame.data)
    } catch {
      continue
    }
    const eventType = parsed.type || frame.event || parsed.event

    if (eventType === 'response.output_text.delta' && parsed.delta) {
      output += parsed.delta
      continue
    }

    if (eventType === 'response.completed') {
      const response = parsed.response || parsed
      const finalText = extractResponseText(response)
      if (!output && finalText) output = finalText
      if (!output || output.trim() === '') {
        throw new Error('Empty summarization response')
      }
      return output.trim()
    }

    if (eventType === 'response.failed') {
      throw new Error(parsed.error?.message || parsed.error || 'Summarization response failed')
    }
  }

  throw new Error('Summarization response stream ended without a terminal event')
}

// ─── Main Compressor ────────────────────────────────────

export class ChatContextCompressor {
  private config: CompressionConfig

  constructor(opts?: {
    config?: Partial<CompressionConfig>
  }) {
    this.config = { ...DEFAULT_COMPRESSION_CONFIG, ...opts?.config }
  }

  /**
   * Assemble and compress conversation history.
   *
   * Flow:
   * 1. Check snapshot → if exists, assemble = summary + new messages after snapshot index
   * 2. If no snapshot → assemble = all messages
   * 3. Count tokens of assembled context
   * 4. Under threshold → return assembled as-is (no LLM call)
   * 5. Over threshold → LLM compress, keep last N messages, save new snapshot
   */
  async compress(
    messages: ChatMessage[],
    upstream: string,
    apiKey: string | undefined,
    sessionId?: string,
    profile?: string,
  ): Promise<CompressedResult> {
    const total = messages.length

    const makeMeta = (opts: Partial<CompressedResult['meta']> = {}): CompressedResult['meta'] => ({
      totalMessages: total,
      compressed: false,
      llmCompressed: false,
      summaryTokenEstimate: 0,
      verbatimCount: total,
      compressedStartIndex: -1,
      ...opts,
    })

    // Check if we have a previous compression snapshot
    const snapshot = sessionId ? getCompressionSnapshot(sessionId) : null

    if (snapshot) {
      // Has snapshot → incremental compress (merge old summary with new messages)
      logger.info(
        '[context-compressor] session=%s: incremental compress with snapshot at index %d',
        sessionId, snapshot.lastMessageIndex,
      )
      return this.incrementalCompress(
        messages, snapshot, upstream, apiKey, sessionId!, makeMeta(), profile,
      )
    } else {
      // No snapshot → full compress (compress all messages)
      logger.info(
        '[context-compressor] session=%s: full compress %d messages',
        sessionId, total,
      )
      return this.fullCompress(messages, upstream, apiKey, sessionId!, makeMeta(), profile)
    }
  }

  private async incrementalCompress(
    messages: ChatMessage[],
    snapshot: { summary: string; lastMessageIndex: number },
    upstream: string,
    apiKey: string | undefined,
    sessionId: string,
    meta: CompressedResult['meta'],
    profile?: string,
  ): Promise<CompressedResult> {
    const { summary: previousSummary, lastMessageIndex } = snapshot
    const total = messages.length
    const cleaned = pruneOldToolResults(messages, this.config.tailMessageCount)
    const newMessages = cleaned.slice(lastMessageIndex + 1)
    const tailCount = this.config.tailMessageCount

    // Keep last N of new messages, compress the rest
    const tailStart = Math.max(0, newMessages.length - tailCount)
    const toCompress = newMessages.slice(0, tailStart)
    const tail = newMessages.slice(tailStart)

    if (toCompress.length === 0) {
      return {
        messages: [
          { role: 'user', content: SUMMARY_PREFIX + '\n\n' + previousSummary },
          ...tail,
        ],
        meta: {
          ...meta,
          compressed: true,
          llmCompressed: false,
          summaryTokenEstimate: countTokens(SUMMARY_PREFIX + previousSummary),
          verbatimCount: tail.length,
          compressedStartIndex: lastMessageIndex,
          skippedReason: 'no_new_messages_to_summarize',
        },
      }
    }

    logger.info(
      '[context-compressor] [incremental-llm] compressing %d of %d new messages, keeping %d tail',
      toCompress.length, newMessages.length, tail.length,
    )

    let summary: string | null = null
    let summarizationError: string | undefined
    try {
      const contentToSummarize = boundedSummaryInput(toCompress)
      const prompt = buildIncrementalPrompt(previousSummary, contentToSummarize, this.config.summaryBudget)
      const history: Array<{ role: string; content: string }> = []

      const t0 = Date.now()
      summary = await callSummarizer(upstream, apiKey, prompt, history, this.config.summarizationTimeoutMs, undefined, profile)
      logger.info('[context-compressor] incremental-llm done in %dms, %d chars', Date.now() - t0, summary.length)
    } catch (err: any) {
      summarizationError = err?.message || 'Summarization failed'
      logger.warn('[context-compressor] incremental-llm failed: %s — saving deterministic rolling fallback snapshot', summarizationError)
      const fallbackSummary = buildDeterministicFallbackSummary(messages, toCompress, lastMessageIndex + tailStart, summarizationError)
      const fallbackResult: ChatMessage[] = [
        { role: 'user', content: SUMMARY_PREFIX + '\n\n' + fallbackSummary },
        ...tail,
      ]
      const newLastIndex = lastMessageIndex + tailStart
      if (sessionId) {
        saveCompressionSnapshot(sessionId, fallbackSummary, newLastIndex, total)
      }
      return {
        messages: fallbackResult,
        meta: {
          ...meta,
          compressed: true,
          llmCompressed: false,
          summaryTokenEstimate: countTokens(SUMMARY_PREFIX + fallbackSummary),
          verbatimCount: tail.length,
          compressedStartIndex: newLastIndex,
          error: summarizationError,
          skippedReason: 'deterministic_incremental_fallback_after_summarization_failed',
        },
      }
    }

    const result: ChatMessage[] = [
      { role: 'user', content: SUMMARY_PREFIX + '\n\n' + summary },
      ...tail,
    ]

    const newLastIndex = lastMessageIndex + tailStart
    if (sessionId) {
      saveCompressionSnapshot(sessionId, summary, newLastIndex, total)
    }

    return {
      messages: result,
      meta: {
        ...meta,
        compressed: true,
        llmCompressed: true,
        summaryTokenEstimate: countTokens(SUMMARY_PREFIX + summary),
        verbatimCount: tail.length,
        compressedStartIndex: newLastIndex,
      },
    }
  }

  private async fullCompress(
    messages: ChatMessage[],
    upstream: string,
    apiKey: string | undefined,
    sessionId: string,
    meta: CompressedResult['meta'],
    profile?: string,
  ): Promise<CompressedResult> {
    const total = messages.length
    const cleaned = pruneOldToolResults(messages, this.config.tailMessageCount)
    const tailCount = this.config.tailMessageCount

    if (total <= tailCount) {
      return { messages: cleaned, meta }
    }

    const tailStart = total - tailCount
    const toCompress = cleaned.slice(0, tailStart)
    const tail = cleaned.slice(tailStart)

    logger.info(
      '[context-compressor] [full-llm] compressing messages 0-%d, keeping %d-%d',
      tailStart - 1, tailStart, total - 1,
    )

    const contentToSummarize = boundedSummaryInput(toCompress)
    const prompt = buildFullPrompt(contentToSummarize, this.config.summaryBudget)
    const history: Array<{ role: string; content: string }> = []

    let summary: string | null = null
    let summarizationError: string | undefined
    try {
      const t0 = Date.now()
      summary = await callSummarizer(upstream, apiKey, prompt, history, this.config.summarizationTimeoutMs, undefined, profile)
      logger.info('[context-compressor] full-llm done in %dms, %d chars', Date.now() - t0, summary.length)
    } catch (err: any) {
      summarizationError = err?.message || 'Summarization failed'
      logger.warn('[context-compressor] full-llm failed: %s', summarizationError)
    }

    if (!summary) {
      const fallbackSummary = buildDeterministicFallbackSummary(messages, toCompress, tailStart, summarizationError)
      const result: ChatMessage[] = [
        { role: 'user', content: SUMMARY_PREFIX + '\n\n' + fallbackSummary },
        ...tail,
      ]

      if (sessionId) {
        saveCompressionSnapshot(sessionId, fallbackSummary, tailStart - 1, total)
      }

      return {
        messages: result,
        meta: {
          ...meta,
          compressed: true,
          llmCompressed: false,
          summaryTokenEstimate: countTokens(SUMMARY_PREFIX + fallbackSummary),
          verbatimCount: tail.length,
          compressedStartIndex: tailStart - 1,
          error: summarizationError,
          skippedReason: 'deterministic_fallback_after_summarization_failed',
        },
      }
    }

    const result: ChatMessage[] = [
      { role: 'user', content: SUMMARY_PREFIX + '\n\n' + summary },
      ...tail,
    ]

    if (sessionId) {
      saveCompressionSnapshot(sessionId, summary, tailStart - 1, total)
    }

    return {
      messages: result,
      meta: {
        ...meta,
        compressed: true,
        llmCompressed: true,
        summaryTokenEstimate: countTokens(SUMMARY_PREFIX + summary),
        verbatimCount: tail.length,
        compressedStartIndex: tailStart - 1,
      },
    }
  }

  /** Remove snapshot for a session (e.g. when session is deleted) */
  static invalidateSnapshot(sessionId: string): void {
    deleteCompressionSnapshot(sessionId)
  }
}

async function* readSseFrames(stream: ReadableStream<Uint8Array>): AsyncGenerator<{ event?: string; data: string }> {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const raw = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const frame = parseSseFrame(raw)
        if (frame?.data) yield frame
        boundary = buffer.indexOf('\n\n')
      }
    }

    buffer += decoder.decode()
    const frame = parseSseFrame(buffer)
    if (frame?.data) yield frame
  } finally {
    reader.releaseLock()
  }
}

function parseSseFrame(raw: string): { event?: string; data: string } | null {
  let event: string | undefined
  const data: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart())
    }
  }
  if (data.length === 0) return null
  return { event, data: data.join('\n') }
}

function extractResponseText(response: any): string {
  const output = Array.isArray(response?.output) ? response.output : []
  const parts: string[] = []
  for (const item of output) {
    if (item.type !== 'message') continue
    const content = Array.isArray(item.content) ? item.content : []
    for (const part of content) {
      if (part.type === 'output_text' || part.type === 'text') {
        parts.push(part.text || '')
      }
    }
  }
  if (parts.length > 0) return parts.join('')
  return typeof response?.output_text === 'string' ? response.output_text : ''
}
