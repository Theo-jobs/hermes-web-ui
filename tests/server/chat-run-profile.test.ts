import { beforeEach, describe, expect, it, vi } from 'vitest'

const listProfileNamesFromDiskMock = vi.fn()
const listGatewayRegistryMock = vi.fn()

vi.mock('../../packages/server/src/services/hermes/hermes-profile', () => ({
  getActiveProfileName: () => 'default',
  getProfileDir: vi.fn(),
  listProfileNamesFromDisk: listProfileNamesFromDiskMock,
}))

vi.mock('../../packages/server/src/services/hermes/gateway-registry', () => ({
  gatewayRegistryService: {
    listGateways: listGatewayRegistryMock,
  },
}))

describe('chat-run profile routing', () => {
  beforeEach(() => {
    vi.resetModules()
    listProfileNamesFromDiskMock.mockReset()
    listGatewayRegistryMock.mockReset()
    listProfileNamesFromDiskMock.mockReturnValue(['default'])
    listGatewayRegistryMock.mockReturnValue([])
  })

  it('accepts remote gateway registry profiles even when they are not local Hermes profiles', async () => {
    listGatewayRegistryMock.mockReturnValue([
      { id: 'hefeng', profile: 'hefeng', type: 'remote' },
    ])

    const { isKnownRunProfile } = await import('../../packages/server/src/services/hermes/run-chat')

    expect(isKnownRunProfile('hefeng')).toBe(true)
    expect(isKnownRunProfile('deleted-profile')).toBe(false)
  })
})
