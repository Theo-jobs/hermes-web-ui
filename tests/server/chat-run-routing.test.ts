import { describe, it, expect, vi } from 'vitest'

vi.mock('../../packages/server/src/db/hermes/session-store', () => ({
  getSession: vi.fn(),
  getSessionDetail: vi.fn(),
  getSessionDetailPaginated: vi.fn(),
  createSession: vi.fn(),
  addMessage: vi.fn(),
  updateSessionProfile: vi.fn(),
  updateSessionStats: vi.fn(),
  useLocalSessionStore: vi.fn(() => false),
}))

vi.mock('../../packages/server/src/db/hermes/sessions-db', () => ({
  getSessionDetailFromDb: vi.fn(),
}))

vi.mock('../../packages/server/src/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../packages/server/src/lib/context-compressor', () => ({
  ChatContextCompressor: class {},
  countTokens: vi.fn(() => 1),
  SUMMARY_PREFIX: '[Summary] ',
}))

vi.mock('../../packages/server/src/db/hermes/compression-snapshot', () => ({
  getCompressionSnapshot: vi.fn(),
}))

vi.mock('../../packages/server/src/lib/llm-json', () => ({
  parseAnthropicContentArray: vi.fn(),
}))

vi.mock('../../packages/server/src/lib/llm-prompt', () => ({
  getSystemPrompt: vi.fn(() => ''),
}))

vi.mock('../../packages/server/src/db/hermes/usage-store', () => ({
  updateUsage: vi.fn(),
}))

import { resolveSessionBoundRunConfig } from '../../packages/server/src/services/hermes/run-chat/handle-api-run'

describe('chat run routing', () => {
  it('lets the requested profile bind the first run of an empty persisted draft session', () => {
    const bound = resolveSessionBoundRunConfig(
      { profile: 'default', model: 'local-model', message_count: 0 },
      'default',
      'remote-agent',
      'remote-model',
    )

    expect(bound).toEqual({ profile: 'remote-agent', model: 'remote-model' })
  })

  it('keeps the persisted profile once the conversation has messages', () => {
    const bound = resolveSessionBoundRunConfig(
      { profile: 'default', model: 'local-model', message_count: 2 },
      'default',
      'remote-agent',
      undefined,
    )

    expect(bound).toEqual({ profile: 'default', model: 'local-model' })
  })
})
