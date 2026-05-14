// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useChatStore } from '@/stores/hermes/chat'
import { startRunViaSocket } from '@/api/hermes/chat'
import { fetchSessions } from '@/api/hermes/sessions'
import { filterSessionsForProfileWithFallback } from '@/components/hermes/chat/session-profile-filter'

vi.mock('@/api/hermes/chat', () => ({
  startRunViaSocket: vi.fn(() => ({ abort: vi.fn() })),
  resumeSession: vi.fn((_sessionId: string, onResumed: any) => {
    onResumed({ session_id: _sessionId, messages: [], isWorking: false, events: [] })
    return { emit: vi.fn(), once: vi.fn() }
  }),
  registerSessionHandlers: vi.fn(),
  unregisterSessionHandlers: vi.fn(),
  getChatRunSocket: vi.fn(() => null),
}))

vi.mock('@/api/hermes/followups', () => ({
  generateFollowupSuggestions: vi.fn(),
}))

vi.mock('@/api/hermes/sessions', () => ({
  fetchSessions: vi.fn(async () => []),
  fetchSession: vi.fn(async () => null),
  deleteSession: vi.fn(async () => true),
}))

const mockedStartRunViaSocket = vi.mocked(startRunViaSocket)
const mockedFetchSessions = vi.mocked(fetchSessions)

function sessionSummary(id: string, profile: string, lastActive: number) {
  return {
    id,
    profile,
    source: 'api_server',
    model: 'gpt-5.5',
    title: `${profile} chat`,
    started_at: Math.max(1, lastActive - 100),
    ended_at: null,
    last_active: lastActive,
    message_count: 2,
    tool_call_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    reasoning_tokens: 0,
    billing_provider: null,
    estimated_cost_usd: 0,
    actual_cost_usd: null,
    cost_status: '',
  }
}

describe('chat store routing', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    mockedStartRunViaSocket.mockClear()
    mockedFetchSessions.mockReset()
    mockedFetchSessions.mockResolvedValue([])
  })


  it('filters chat panel session lists by selected gateway profile and falls back when empty', () => {
    const sessions = [
      { id: 'default-old', profile: 'default', updatedAt: 200 },
      { id: 'remote-old', profile: 'remote-agent', updatedAt: 300 },
      { id: 'minion-old', profile: 'remote-peer', updatedAt: 250 },
    ] as any

    expect(filterSessionsForProfileWithFallback(sessions, 'default').map((s: any) => s.id)).toEqual(['default-old'])
    expect(filterSessionsForProfileWithFallback(sessions, 'remote-agent').map((s: any) => s.id)).toEqual(['remote-old'])
    expect(filterSessionsForProfileWithFallback(sessions, 'remote-peer').map((s: any) => s.id)).toEqual(['minion-old'])
    expect(filterSessionsForProfileWithFallback(sessions, 'new-profile').map((s: any) => s.id)).toEqual([
      'default-old',
      'remote-old',
      'minion-old',
    ])
  })

  it('sends the newly selected gateway profile on the first run of a draft chat', async () => {
    const store = useChatStore()

    store.newChat()
    store.setNextSessionGateway({ profile: 'remote-agent', spaceId: 'remote-workspace', model: 'remote-model' })

    await store.sendMessage('你是谁')

    expect(mockedStartRunViaSocket).toHaveBeenCalledTimes(1)
    expect(mockedStartRunViaSocket.mock.calls[0][0]).toMatchObject({
      input: '你是谁',
      session_id: store.activeSessionId,
      profile: 'remote-agent',
      model: 'remote-model',
    })
  })

  it('does not rebind an existing conversation when the next gateway changes', async () => {
    const store = useChatStore()

    store.newChat()
    await store.sendMessage('本机会话第一条')
    const localSessionId = store.activeSessionId

    store.setNextSessionGateway({ profile: 'remote-agent', spaceId: 'remote-workspace', model: 'remote-model' })
    await store.sendMessage('继续旧会话')

    expect(store.activeSession?.profile).toBe('default')
    expect(mockedStartRunViaSocket.mock.calls.at(-1)?.[0]).toMatchObject({
      session_id: localSessionId,
      profile: 'default',
    })
  })

  it('restores the selected remote profile session after reload instead of falling back to default', async () => {
    localStorage.setItem('hermes_next_session_profile', 'remote-agent')
    localStorage.setItem('hermes_active_session_remote-agent', 'remote-old')
    localStorage.setItem('hermes_active_session_default', 'default-old')
    setActivePinia(createPinia())

    mockedFetchSessions.mockResolvedValue([
      {
        id: 'default-old',
        profile: 'default',
        source: 'api_server',
        model: 'gpt-5.5',
        title: 'Local chat',
        started_at: 100,
        ended_at: null,
        last_active: 200,
        message_count: 2,
        tool_call_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
        billing_provider: null,
        estimated_cost_usd: 0,
        actual_cost_usd: null,
        cost_status: '',
      },
      {
        id: 'remote-old',
        profile: 'remote-agent',
        source: 'api_server',
        model: 'gpt-5.5',
        title: 'Remote chat',
        started_at: 110,
        ended_at: null,
        last_active: 300,
        message_count: 4,
        tool_call_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
        billing_provider: null,
        estimated_cost_usd: 0,
        actual_cost_usd: null,
        cost_status: '',
      },
    ] as any)

    const store = useChatStore()
    await store.loadSessions()

    expect(store.activeSessionId).toBe('remote-old')
    expect(store.activeSession?.profile).toBe('remote-agent')
  })

  it('keeps separate last-active session keys per gateway profile', async () => {
    mockedFetchSessions.mockResolvedValue([
      sessionSummary('default-old', 'default', 200),
      sessionSummary('remote-old', 'remote-agent', 300),
      sessionSummary('minion-old', 'remote-peer', 250),
    ] as any)

    const store = useChatStore()
    await store.loadSessions()
    await store.switchSession('remote-old')
    await store.switchSession('minion-old')

    expect(localStorage.getItem('hermes_active_session_remote-agent')).toBe('remote-old')
    expect(localStorage.getItem('hermes_active_session_remote-peer')).toBe('minion-old')
    expect(localStorage.getItem('hermes_active_session_default')).toBe('default-old')
  })

  it('can switch immediately to the most recent session for the selected remote profile', async () => {
    mockedFetchSessions.mockResolvedValue([
      sessionSummary('default-old', 'default', 200),
      sessionSummary('remote-old', 'remote-agent', 300),
    ] as any)

    const store = useChatStore()
    await store.loadSessions()
    store.setNextSessionGateway({ profile: 'remote-agent', spaceId: 'remote-workspace' })

    const switched = await store.switchToMostRecentSessionForProfile('remote-agent')

    expect(switched).toBe(true)
    expect(store.activeSessionId).toBe('remote-old')
    expect(store.activeSession?.profile).toBe('remote-agent')
  })

})
