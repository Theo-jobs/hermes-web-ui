// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

const sockets: any[] = []
const ioMock = vi.fn((_url: string, options: any) => {
  const socket = {
    connected: true,
    options,
    on: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
    removeAllListeners: vi.fn(),
    disconnect: vi.fn(function (this: any) { this.connected = false }),
  }
  sockets.push(socket)
  return socket
})

vi.mock('socket.io-client', () => ({ io: ioMock }))
vi.mock('@/api/client', () => ({
  getBaseUrlValue: () => '',
  getApiKey: () => '',
}))

describe('chat run socket profile routing', () => {
  beforeEach(async () => {
    localStorage.clear()
    ioMock.mockClear()
    sockets.length = 0
    const mod = await import('@/api/hermes/chat')
    mod.disconnectChatRun()
  })

  it('connects chat-run with the requested run profile instead of the active profile', async () => {
    localStorage.setItem('hermes_active_profile_name', 'default')
    const { startRunViaSocket, disconnectChatRun } = await import('@/api/hermes/chat')

    startRunViaSocket(
      { session_id: 'session-1', input: 'hello', profile: 'remote-agent', source: 'cli' },
      vi.fn(),
      vi.fn(),
      vi.fn(),
    )

    expect(ioMock).toHaveBeenCalledTimes(1)
    expect(ioMock.mock.calls[0][1].query).toEqual({ profile: 'remote-agent' })
    expect(sockets[0].emit).toHaveBeenCalledWith('run', expect.objectContaining({ profile: 'remote-agent' }))
    disconnectChatRun()
  })

  it('reconnects when a later run targets a different profile', async () => {
    const { startRunViaSocket, disconnectChatRun } = await import('@/api/hermes/chat')

    startRunViaSocket({ session_id: 'session-1', input: 'one', profile: 'default' }, vi.fn(), vi.fn(), vi.fn())
    startRunViaSocket({ session_id: 'session-2', input: 'two', profile: 'remote-agent' }, vi.fn(), vi.fn(), vi.fn())

    expect(ioMock).toHaveBeenCalledTimes(2)
    expect(sockets[0].disconnect).toHaveBeenCalledTimes(1)
    expect(ioMock.mock.calls[1][1].query).toEqual({ profile: 'remote-agent' })
    disconnectChatRun()
  })
})
