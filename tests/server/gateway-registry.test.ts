import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { gatewayRegistryService } from '../../packages/server/src/services/hermes/gateway-registry'

let stateDir = ''
const originalEnv = { ...process.env }

describe('gateway registry service', () => {
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'hermes-gateway-registry-'))
    process.env = { ...originalEnv, HERMES_WEB_UI_STATE_DIR: stateDir }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    if (stateDir) rmSync(stateDir, { recursive: true, force: true })
  })

  it('seeds local and remote agent defaults from the remote agents env file', () => {
    writeFileSync(join(stateDir, '.remote-agents.env'), [
      'REMOTE_AGENT_UPSTREAM=http://203.0.113.10:8642',
      'REMOTE_AGENT_API_SERVER_KEY=dummy-secret',
      '',
    ].join('\n'), 'utf-8')

    const gateways = gatewayRegistryService.listGateways()
    const spaces = gatewayRegistryService.listSpaces()

    expect(gateways).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'local-default', profile: 'default', type: 'local' }),
      expect.objectContaining({
        id: 'remote-agent',
        profile: 'remote-agent',
        type: 'remote',
        upstream: 'http://203.0.113.10:8642',
        apiKeyEnv: 'REMOTE_AGENT_API_SERVER_KEY',
        readonly: true,
      }),
    ]))
    expect(spaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'daily-mac', gatewayId: 'local-default', profile: 'default' }),
      expect.objectContaining({ id: 'remote-workspace', gatewayId: 'remote-agent', profile: 'remote-agent' }),
    ]))
  })

  it('redacts key values and rejects raw secret fields', () => {
    process.env.TEST_GATEWAY_KEY = 'dummy-secret'

    const gateway = gatewayRegistryService.upsertGateway({
      id: 'remote-one',
      profile: 'remote-one',
      type: 'remote',
      displayName: 'Remote One',
      upstream: 'https://example.test',
      apiKeyEnv: 'TEST_GATEWAY_KEY',
    })

    expect(gateway).toMatchObject({ id: 'remote-one', apiKeyEnv: 'TEST_GATEWAY_KEY', hasApiKey: true })
    expect(gateway).not.toHaveProperty('apiKey')
    expect(readFileSync(join(stateDir, 'gateways.json'), 'utf-8')).not.toContain('dummy-secret')
    expect(() => gatewayRegistryService.upsertGateway({
      id: 'bad-secret',
      profile: 'bad-secret',
      apiKey: 'dummy-secret',
    })).toThrow(/raw secrets/)
  })
})

