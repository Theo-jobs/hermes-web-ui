import { describe, expect, it } from 'vitest'
import {
  getSessionRunSourceGroupKey,
  groupSessionsByRunSource,
} from '@/components/hermes/chat/session-source-groups'

describe('chat session source groups', () => {
  it('normalizes session sources into bridge, api server, and other groups', () => {
    expect(getSessionRunSourceGroupKey('cli')).toBe('cli')
    expect(getSessionRunSourceGroupKey('api_server')).toBe('api_server')
    expect(getSessionRunSourceGroupKey('telegram')).toBe('other')
    expect(getSessionRunSourceGroupKey(undefined)).toBe('other')
  })

  it('groups sessions by source while preserving order inside each group', () => {
    const sessions = [
      { id: 'api-new', source: 'api_server' },
      { id: 'bridge-new', source: 'cli' },
      { id: 'api-old', source: 'api_server' },
      { id: 'other', source: 'telegram' },
    ]

    expect(groupSessionsByRunSource(sessions)).toEqual([
      { key: 'cli', sessions: [sessions[1]] },
      { key: 'api_server', sessions: [sessions[0], sessions[2]] },
      { key: 'other', sessions: [sessions[3]] },
    ])
  })
})
