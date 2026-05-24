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
  onPeerUserMessage: vi.fn(),
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
      { id: 'default-old', profile: 'default', spaceId: null, title: 'Local', updatedAt: 200 },
      { id: 'remote-old', profile: 'remote-agent', spaceId: null, title: 'Legacy remote', updatedAt: 300 },
      { id: 'remote-work', profile: 'remote-agent', spaceId: 'remote-workspace', title: 'Workspace remote', updatedAt: 350 },
      { id: 'minion-old', profile: 'remote-peer', spaceId: 'minion-work', title: 'Minion', updatedAt: 250 },
    ] as any

    expect(filterSessionsForProfileWithFallback(sessions, 'default').map((s: any) => s.id)).toEqual(['default-old'])
    expect(filterSessionsForProfileWithFallback(sessions, 'remote-agent').map((s: any) => s.id)).toEqual(['remote-old', 'remote-work'])
    expect(filterSessionsForProfileWithFallback(sessions, 'remote-agent', 'remote-workspace').map((s: any) => s.id)).toEqual(['remote-work', 'remote-old'])
    expect(filterSessionsForProfileWithFallback(sessions, 'remote-agent', 'missing-space').map((s: any) => s.id)).toEqual(['remote-old'])
    expect(filterSessionsForProfileWithFallback(sessions, 'remote-peer').map((s: any) => s.id)).toEqual(['minion-old'])
    expect(filterSessionsForProfileWithFallback(sessions, 'new-profile').map((s: any) => s.id)).toEqual([
      'default-old',
      'remote-old',
      'remote-work',
      'minion-old',
    ])
  })

  it('sends the newly selected gateway profile on the first run of a draft chat', async () => {
    const store = useChatStore()

    store.newChat()
    store.setNextSessionGateway({
      profile: 'remote-agent',
      spaceId: 'remote-workspace',
      model: 'remote-model',
      provider: 'custom:remote',
    })

    await store.sendMessage('你是谁')

    expect(mockedStartRunViaSocket).toHaveBeenCalledTimes(1)
    expect(mockedStartRunViaSocket.mock.calls[0][0]).toMatchObject({
      input: '你是谁',
      session_id: store.activeSessionId,
      profile: 'remote-agent',
      model: 'remote-model',
      provider: 'custom:remote',
      model_groups: expect.arrayContaining([
        { provider: 'custom:remote', models: ['remote-model'] },
      ]),
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

  it('restores a selected gateway target to a target draft when no matching history exists', async () => {
    localStorage.setItem('hermes_next_session_profile', 'remote-agent')
    localStorage.setItem('hermes_next_session_space', 'remote-workspace')
    localStorage.setItem('hermes_next_session_model', 'remote-model')
    localStorage.setItem('hermes_next_session_provider', 'custom:remote')
    setActivePinia(createPinia())

    mockedFetchSessions.mockResolvedValue([
      { ...sessionSummary('default-old', 'default', 200), space_id: null },
    ] as any)

    const store = useChatStore()
    await store.loadSessions()

    expect(store.activeSessionId).not.toBe('default-old')
    expect(store.activeSession).toMatchObject({
      profile: 'remote-agent',
      spaceId: 'remote-workspace',
      model: 'remote-model',
      provider: 'custom:remote',
    })
    expect(store.activeSession?.messages).toEqual([])
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


  it('prefers an exact gateway space session, then falls back to same-profile legacy null-space history', async () => {
    mockedFetchSessions.mockResolvedValue([
      { ...sessionSummary('remote-other-space', 'remote-agent', 500), space_id: 'other-space' },
      { ...sessionSummary('remote-newer-legacy', 'remote-agent', 400), space_id: null },
      { ...sessionSummary('remote-workspace-old', 'remote-agent', 300), space_id: 'remote-workspace' },
      { ...sessionSummary('default-old', 'default', 200), space_id: null },
    ] as any)

    const store = useChatStore()
    await store.loadSessions()

    let switched = await store.switchToMostRecentSessionForGateway('remote-agent', 'remote-workspace')
    expect(switched).toBe(true)
    expect(store.activeSessionId).toBe('remote-workspace-old')

    switched = await store.switchToMostRecentSessionForGateway('remote-agent', 'missing-space')
    expect(switched).toBe(true)
    expect(store.activeSessionId).toBe('remote-newer-legacy')
    expect(store.activeSession?.spaceId).toBeNull()
  })

  it('creates or switches to a target-specific draft when no matching gateway session exists', async () => {
    mockedFetchSessions.mockResolvedValue([
      { ...sessionSummary('default-old', 'default', 200), space_id: null },
      { ...sessionSummary('remote-other-space', 'remote-agent', 300), space_id: 'other-space' },
    ] as any)

    const store = useChatStore()
    await store.loadSessions()

    const switched = await store.switchToGatewayTargetSession({
      profile: 'remote-agent',
      spaceId: 'remote-workspace',
      model: 'remote-model',
      provider: 'custom:remote',
    })

    expect(switched).toBe(true)
    expect(store.activeSessionId).not.toBe('default-old')
    expect(store.activeSessionId).not.toBe('remote-other-space')
    expect(store.activeSession).toMatchObject({
      profile: 'remote-agent',
      spaceId: 'remote-workspace',
      model: 'remote-model',
      provider: 'custom:remote',
    })
    expect(store.activeSession?.messages).toEqual([])
  })

  it('switches to legacy remote history without rebinding it to the selected space', async () => {
    mockedFetchSessions.mockResolvedValue([
      { ...sessionSummary('remote-legacy', 'remote-agent', 400), space_id: null },
      { ...sessionSummary('default-old', 'default', 200), space_id: null },
    ] as any)

    const store = useChatStore()
    await store.loadSessions()

    await store.switchToGatewayTargetSession({
      profile: 'remote-agent',
      spaceId: 'remote-workspace',
      model: 'remote-model',
      provider: 'custom:remote',
    })

    expect(store.activeSessionId).toBe('remote-legacy')
    expect(store.activeSession?.spaceId).toBeNull()
    expect(store.nextSessionSpaceId).toBe('remote-workspace')
  })

  it('does not reuse a gateway-only session when provider and model differ', async () => {
    mockedFetchSessions.mockResolvedValue([
      {
        ...sessionSummary('remote-one-old', 'remote-agent', 500),
        provider: 'custom:one',
        model: 'model-one',
        space_id: null,
      },
    ] as any)

    const store = useChatStore()
    await store.loadSessions()

    await store.switchToGatewayTargetSession({
      profile: 'remote-agent',
      model: 'model-two',
      provider: 'custom:two',
    })

    expect(store.activeSessionId).not.toBe('remote-one-old')
    expect(store.activeSession).toMatchObject({
      profile: 'remote-agent',
      spaceId: null,
      model: 'model-two',
      provider: 'custom:two',
    })
  })

  it('runs a selected remote gateway target through the api server profile instead of the local cli profile', async () => {
    const store = useChatStore()

    await store.switchToGatewayTargetSession({
      profile: 'hefeng',
      spaceId: 'hefeng-work',
      model: 'gpt-5.5',
      provider: 'custom:hefeng',
      source: 'api_server',
    })
    await store.sendMessage('远程验收')

    expect(store.activeSession).toMatchObject({
      profile: 'hefeng',
      spaceId: 'hefeng-work',
      source: 'api_server',
      model: 'gpt-5.5',
      provider: 'custom:hefeng',
    })
    expect(mockedStartRunViaSocket.mock.calls[0][0]).toMatchObject({
      input: '远程验收',
      profile: 'hefeng',
      source: 'api_server',
      model: 'gpt-5.5',
      provider: 'custom:hefeng',
    })
  })

  it('keeps remote gateway source across new chats and reload drafts', async () => {
    localStorage.setItem('hermes_next_session_profile', 'hefeng')
    localStorage.setItem('hermes_next_session_space', 'hefeng-work')
    localStorage.setItem('hermes_next_session_model', 'gpt-5.5')
    localStorage.setItem('hermes_next_session_provider', 'custom:hefeng')
    localStorage.setItem('hermes_next_session_source', 'api_server')
    setActivePinia(createPinia())

    mockedFetchSessions.mockResolvedValue([
      { ...sessionSummary('default-old', 'default', 200), space_id: null },
    ] as any)

    const store = useChatStore()
    await store.loadSessions()

    expect(store.activeSession).toMatchObject({
      profile: 'hefeng',
      spaceId: 'hefeng-work',
      source: 'api_server',
    })

    store.newChat({
      profile: 'hefeng',
      spaceId: 'hefeng-work',
      model: 'gpt-5.5',
      provider: 'custom:hefeng',
      source: 'api_server',
    })

    expect(store.activeSession).toMatchObject({
      profile: 'hefeng',
      spaceId: 'hefeng-work',
      source: 'api_server',
    })
  })

  it('allows the new-chat UI to override a remote target back to bridge mode', () => {
    const store = useChatStore()

    store.newChat({
      profile: 'hefeng',
      spaceId: 'hefeng-work',
      model: 'gpt-5.5',
      provider: 'custom:hefeng',
      source: 'cli',
    })

    expect(store.nextSessionProfile).toBe('hefeng')
    expect(store.nextSessionSpaceId).toBe('hefeng-work')
    expect(store.nextSessionSource).toBe('cli')
    expect(store.activeSession).toMatchObject({
      profile: 'hefeng',
      spaceId: 'hefeng-work',
      model: 'gpt-5.5',
      provider: 'custom:hefeng',
      source: 'cli',
    })
  })

  it('keeps a bridge session in bridge mode when it is clicked from a remote gateway list', async () => {
    const store = useChatStore()

    store.newChat({
      profile: 'hefeng',
      spaceId: 'hefeng-work',
      model: 'gpt-5.5',
      provider: 'custom:hefeng',
      source: 'cli',
    })
    const bridgeSessionId = store.activeSessionId!

    await store.switchToSessionWithGatewayContext(bridgeSessionId, {
      profile: 'hefeng',
      spaceId: 'hefeng-work',
      model: 'gpt-5.5',
      provider: 'custom:hefeng',
      source: 'api_server',
    })
    await store.sendMessage('Bridge should stay bridge')

    expect(store.activeSession?.source).toBe('cli')
    expect(store.nextSessionSource).toBe('cli')
    expect(mockedStartRunViaSocket.mock.calls[0][0]).toMatchObject({
      input: 'Bridge should stay bridge',
      profile: 'hefeng',
      source: 'cli',
      model: 'gpt-5.5',
      provider: 'custom:hefeng',
    })
  })

  it('does not let a pending session refresh replace a newly created bridge draft', async () => {
    let resolveFetch: (value: any[]) => void = () => {}
    mockedFetchSessions.mockReturnValue(new Promise(resolve => {
      resolveFetch = resolve
    }) as any)

    const store = useChatStore()
    const loadPromise = store.loadSessions()

    store.newChat({
      profile: 'hefeng',
      spaceId: 'hefeng-work',
      model: 'gpt-5.5',
      provider: 'custom:hefeng',
      source: 'cli',
    })
    const draftId = store.activeSessionId

    resolveFetch([
      {
        ...sessionSummary('hefeng-old-api', 'hefeng', 500),
        space_id: 'hefeng-work',
        source: 'api_server',
        provider: 'custom:hefeng',
        model: 'gpt-5.5',
        title: 'Older API session',
      },
    ] as any)
    await loadPromise

    expect(store.activeSessionId).toBe(draftId)
    expect(store.activeSession).toMatchObject({
      id: draftId,
      profile: 'hefeng',
      spaceId: 'hefeng-work',
      source: 'cli',
    })
    expect(store.sessions.some(session => session.id === draftId)).toBe(true)
  })

  it('syncs gateway context when a user clicks a remote history session', async () => {
    mockedFetchSessions.mockResolvedValue([
      { ...sessionSummary('default-old', 'default', 500), space_id: 'daily-mac' },
      {
        ...sessionSummary('hefeng-old', 'hefeng', 400),
        space_id: 'hefeng-work',
        provider: 'custom:hefeng',
        model: 'gpt-5.5',
      },
    ] as any)

    const store = useChatStore()
    await store.loadSessions()

    await store.switchToSessionWithGatewayContext('hefeng-old', {
      profile: 'hefeng',
      spaceId: 'hefeng-work',
      model: 'gpt-5.5',
      provider: 'custom:hefeng',
      source: 'api_server',
    })

    expect(store.activeSessionId).toBe('hefeng-old')
    expect(store.nextSessionProfile).toBe('hefeng')
    expect(store.nextSessionSpaceId).toBe('hefeng-work')
    expect(store.nextSessionSource).toBe('api_server')
    expect(store.activeSession).toMatchObject({
      profile: 'hefeng',
      spaceId: 'hefeng-work',
      source: 'api_server',
    })
  })

  it('does not rebind a loaded history summary while switching gateway targets', async () => {
    mockedFetchSessions.mockResolvedValue([
      { ...sessionSummary('default-old', 'default', 500), title: 'Local default history', space_id: null },
    ] as any)

    const store = useChatStore()
    await store.loadSessions()

    await store.switchToGatewayTargetSession({
      profile: 'remote-agent',
      spaceId: 'remote-workspace',
      model: 'remote-model',
    })

    const defaultSession = store.sessions.find(session => session.id === 'default-old')
    expect(defaultSession).toMatchObject({
      profile: 'default',
      spaceId: null,
    })
    expect(store.activeSessionId).not.toBe('default-old')
    expect(store.activeSession).toMatchObject({ profile: 'remote-agent', spaceId: 'remote-workspace' })
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
