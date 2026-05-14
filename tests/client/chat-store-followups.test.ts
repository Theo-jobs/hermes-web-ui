// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useChatStore, type Session } from '@/stores/hermes/chat'
import { generateFollowupSuggestions } from '@/api/hermes/followups'

vi.mock('@/api/hermes/followups', () => ({
  generateFollowupSuggestions: vi.fn(),
}))

type PendingFollowup = {
  payload: any
  resolve: (value: { suggestions: string[], source: 'model' | 'fallback' }) => void
  reject: (reason?: any) => void
}

const pending: PendingFollowup[] = []
const mockedGenerateFollowups = vi.mocked(generateFollowupSuggestions)

function session(id: string, assistantId: string, content: string): Session {
  return {
    id,
    title: id,
    messages: [
      { id: `${id}-u1`, role: 'user', content: `question ${id}`, timestamp: 1 },
      { id: assistantId, role: 'assistant', content, timestamp: 2 },
    ],
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('chat store followups', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    pending.length = 0
    mockedGenerateFollowups.mockReset()
    mockedGenerateFollowups.mockImplementation((payload: any) => new Promise((resolve, reject) => {
      pending.push({ payload, resolve, reject })
    }))
  })

  it('keeps late followup results bound to their original session', async () => {
    const store = useChatStore()
    store.addOrUpdateSession(session('s1', 'a1', 'answer one'))
    store.addOrUpdateSession(session('s2', 'a2', 'answer two'))

    store.activeSessionId = 's1'
    const first = store.refreshFollowups('s1')
    expect(store.followupForSessionId).toBe('s1')
    expect(store.followupForMessageId).toBe('a1')
    expect(store.followupLoading).toBe(true)

    store.activeSessionId = 's2'
    const second = store.refreshFollowups('s2')
    expect(store.followupForSessionId).toBe('s2')
    expect(store.followupForMessageId).toBe('a2')

    pending[1].resolve({ suggestions: ['s2 next'], source: 'model' })
    await second
    expect(store.followupForSessionId).toBe('s2')
    expect(store.followupSuggestions).toEqual(['s2 next'])

    pending[0].resolve({ suggestions: ['s1 stale'], source: 'model' })
    await first
    expect(store.followupForSessionId).toBe('s2')
    expect(store.followupForMessageId).toBe('a2')
    expect(store.followupSuggestions).toEqual(['s2 next'])
  })

  it('restores cached followups for the same assistant message without regenerating', async () => {
    const store = useChatStore()
    store.addOrUpdateSession(session('s1', 'a1', 'stable answer'))
    store.activeSessionId = 's1'

    const first = store.refreshFollowups('s1')
    pending[0].resolve({ suggestions: ['cached next'], source: 'model' })
    await first
    expect(store.followupSuggestions).toEqual(['cached next'])

    store.clearFollowups()
    expect(store.followupForMessageId).toBeNull()

    await store.refreshFollowups('s1')
    expect(mockedGenerateFollowups).toHaveBeenCalledTimes(1)
    expect(store.followupForSessionId).toBe('s1')
    expect(store.followupForMessageId).toBe('a1')
    expect(store.followupSuggestions).toEqual(['cached next'])
  })

  it('reuses persisted followups after the store is recreated', async () => {
    const firstStore = useChatStore()
    firstStore.addOrUpdateSession(session('s1', 'a1', 'persisted answer'))
    firstStore.activeSessionId = 's1'

    const first = firstStore.refreshFollowups('s1')
    pending[0].resolve({ suggestions: ['persisted next'], source: 'model' })
    await first

    setActivePinia(createPinia())
    const secondStore = useChatStore()
    secondStore.addOrUpdateSession(session('s1', 'a1', 'persisted answer'))
    secondStore.activeSessionId = 's1'

    await secondStore.refreshFollowups('s1')
    expect(mockedGenerateFollowups).toHaveBeenCalledTimes(1)
    expect(secondStore.followupForSessionId).toBe('s1')
    expect(secondStore.followupForMessageId).toBe('a1')
    expect(secondStore.followupSuggestions).toEqual(['persisted next'])
  })

  it('updates gateway target on an empty draft session only', () => {
    const store = useChatStore()
    const draft: Session = {
      id: 'draft',
      title: '',
      profile: 'default',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    }
    store.addOrUpdateSession(draft)
    store.activeSession = draft
    store.activeSessionId = 'draft'

    store.setNextSessionGateway({ profile: 'remote-agent', spaceId: 'remote-workspace', model: 'remote-model' })

    expect(store.nextSessionProfile).toBe('remote-agent')
    expect(store.nextSessionSpaceId).toBe('remote-workspace')
    expect(store.activeSession?.profile).toBe('remote-agent')
    expect(store.activeSession?.spaceId).toBe('remote-workspace')
    expect(store.activeSession?.model).toBe('remote-model')

    draft.messages.push({ id: 'u1', role: 'user', content: 'already sent', timestamp: 2 })
    store.setNextSessionGateway({ profile: 'default', spaceId: 'daily-mac', model: 'local-model' })

    expect(store.nextSessionProfile).toBe('default')
    expect(store.nextSessionSpaceId).toBe('daily-mac')
    expect(store.activeSession?.profile).toBe('remote-agent')
    expect(store.activeSession?.spaceId).toBe('remote-workspace')
    expect(store.activeSession?.model).toBe('remote-model')
  })
})
