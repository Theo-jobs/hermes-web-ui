import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createSession: vi.fn(),
  addMessage: vi.fn(),
  updateSession: vi.fn(),
  updateSessionStats: vi.fn(),
  updateUsage: vi.fn(),
}))

vi.mock('../../packages/server/src/db/hermes/session-store', () => ({
  getSession: mocks.getSession,
  createSession: mocks.createSession,
  addMessage: mocks.addMessage,
  updateSession: mocks.updateSession,
  updateSessionStats: mocks.updateSessionStats,
  getSessionDetail: vi.fn(),
  getSessionDetailPaginated: vi.fn(),
}))

vi.mock('../../packages/server/src/db/hermes/usage-store', () => ({
  updateUsage: mocks.updateUsage,
}))

vi.mock('../../packages/server/src/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  bridgeLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../packages/server/src/lib/llm-prompt', () => ({
  getSystemPrompt: vi.fn(() => ''),
}))

vi.mock('../../packages/server/src/services/hermes/run-chat/compression', () => ({
  buildCompressedHistory: vi.fn(async () => []),
  buildDbHistory: vi.fn(async () => []),
  forceCompressBridgeHistory: vi.fn(),
  pushState: vi.fn(),
  replaceState: vi.fn(),
}))

vi.mock('../../packages/server/src/services/hermes/run-chat/usage', () => ({
  calcAndUpdateUsage: vi.fn(async () => ({ inputTokens: 0, outputTokens: 0 })),
  estimateUsageTokensFromMessages: vi.fn(() => ({ inputTokens: 0, outputTokens: 0 })),
}))

vi.mock('../../packages/server/src/services/hermes/run-chat/model-config', () => ({
  resolveBridgeRunModelConfig: vi.fn(async () => ({ model: 'bridge-model', provider: 'bridge-provider' })),
}))

const SID = 'bridge-failure-session'

function createNsp() {
  const emitted: Array<{ room: string; event: string; payload: any }> = []
  return {
    emitted,
    adapter: { rooms: new Map<string, Set<string>>([[`session:${SID}`, new Set(['socket-1'])]]) },
    to(room: string) {
      return {
        emit(event: string, payload: any) {
          emitted.push({ room, event, payload })
        },
      }
    },
  }
}

function createSocket() {
  const emitted: Array<{ event: string; payload: any }> = []
  return {
    id: 'socket-1',
    connected: true,
    emitted,
    join: vi.fn(),
    emit(event: string, payload: any) {
      emitted.push({ event, payload })
    },
  }
}

function existingSession() {
  return {
    id: SID,
    profile: 'default',
    source: 'cli',
    model: '',
    provider: '',
    workspace: null,
    message_count: 0,
  }
}

async function runBridge(bridge: any) {
  const { handleBridgeRun } = await import('../../packages/server/src/services/hermes/run-chat/handle-bridge-run')
  const nsp = createNsp()
  const socket = createSocket()
  const sessionMap = new Map<string, any>()
  await handleBridgeRun(
    nsp as any,
    socket as any,
    { input: 'hello bridge', session_id: SID, source: 'cli' },
    'default',
    sessionMap,
    bridge,
    false,
    async () => ({ messages: [], isWorking: false, events: [], queue: [] }),
    vi.fn(),
  )
  return { nsp, socket, sessionMap }
}

describe('bridge run failure persistence', () => {
  beforeEach(() => {
    vi.resetModules()
    let nextId = 1
    mocks.getSession.mockReset()
    mocks.getSession.mockReturnValue(existingSession())
    mocks.createSession.mockReset()
    mocks.addMessage.mockReset()
    mocks.addMessage.mockImplementation(() => nextId++)
    mocks.updateSession.mockReset()
    mocks.updateSessionStats.mockReset()
    mocks.updateUsage.mockReset()
  })

  it('persists a visible system message when output polling throws after the run starts', async () => {
    const bridge = {
      chat: vi.fn(async () => ({ ok: true, run_id: 'run-1', session_id: SID, status: 'running' })),
      streamOutput: vi.fn(async function* () {
        throw new Error('connect ECONNREFUSED /tmp/hermes-agent-bridge.sock token=abc123')
      }),
    }

    const { nsp, sessionMap } = await runBridge(bridge)

    const persisted = mocks.addMessage.mock.calls.map(call => call[0])
    expect(persisted.map(message => message.role)).toEqual(['user', 'system'])
    expect(persisted[1].content).toBe('Bridge error: connect ECONNREFUSED /tmp/hermes-agent-bridge.sock token=[REDACTED]')
    expect(sessionMap.get(SID).messages.at(-1)).toMatchObject({
      role: 'system',
      content: 'Bridge error: connect ECONNREFUSED /tmp/hermes-agent-bridge.sock token=[REDACTED]',
    })
    expect(nsp.emitted.find(event => event.event === 'run.failed')?.payload.error)
      .toBe('connect ECONNREFUSED /tmp/hermes-agent-bridge.sock token=[REDACTED]')
    expect(mocks.updateSessionStats).toHaveBeenCalledWith(SID)
  })

  it('persists a visible system message for terminal bridge error chunks', async () => {
    const bridge = {
      chat: vi.fn(async () => ({ ok: true, run_id: 'run-2', session_id: SID, status: 'running' })),
      streamOutput: vi.fn(async function* () {
        yield {
          ok: true,
          run_id: 'run-2',
          session_id: SID,
          status: 'error',
          delta: '',
          cursor: 0,
          output: '',
          done: true,
          result: null,
          error: 'Agent bridge socket closed without a response',
          events: [],
          event_cursor: 0,
        }
      }),
    }

    const { nsp, sessionMap } = await runBridge(bridge)

    const persisted = mocks.addMessage.mock.calls.map(call => call[0])
    expect(persisted.map(message => message.role)).toEqual(['user', 'system'])
    expect(persisted[1].content).toBe('Bridge error: Agent bridge socket closed without a response')
    expect(sessionMap.get(SID).messages.at(-1)).toMatchObject({
      role: 'system',
      content: 'Bridge error: Agent bridge socket closed without a response',
    })
    expect(nsp.emitted.find(event => event.event === 'run.failed')?.payload.error)
      .toBe('Agent bridge socket closed without a response')
  })
})
