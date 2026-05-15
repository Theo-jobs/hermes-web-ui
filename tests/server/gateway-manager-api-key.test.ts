import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let hermesHome = ''
let stateDir = ''
const originalEnv = { ...process.env }

async function loadGatewayManager() {
  const mod = await loadGatewayManagerModule()
  return mod.GatewayManager
}

async function loadGatewayManagerModule() {
  vi.resetModules()
  vi.doMock('../../packages/server/src/services/logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }))
  return import('../../packages/server/src/services/hermes/gateway-manager')
}

describe('GatewayManager API key routing', () => {
  beforeEach(() => {
    hermesHome = join(tmpdir(), `hermes-home-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    stateDir = join(tmpdir(), `hermes-web-ui-state-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(hermesHome, { recursive: true })
    mkdirSync(stateDir, { recursive: true })
    process.env = {
      ...originalEnv,
      HERMES_HOME: hermesHome,
      HERMES_WEB_UI_STATE_DIR: stateDir,
    }
    delete process.env.UPSTREAM
    delete process.env.API_SERVER_KEY
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.doUnmock('../../packages/server/src/services/logger')
    vi.resetModules()
    rmSync(hermesHome, { recursive: true, force: true })
    rmSync(stateDir, { recursive: true, force: true })
  })

  it('prefers local default api_server config key over stale profile env provider key', async () => {
    writeFileSync(join(hermesHome, '.env'), 'API_SERVER_KEY=stale-env-key\n', 'utf-8')
    writeFileSync(join(hermesHome, 'config.yaml'), [
      'platforms:',
      '  api_server:',
      '    key: config-local-key',
      '    extra:',
      '      host: 127.0.0.1',
      '      port: 8642',
      'custom_providers:',
      '  - base_url: http://127.0.0.1:8642',
      '    api_key: ${API_SERVER_KEY}',
      '',
    ].join('\n'), 'utf-8')

    const GatewayManager = await loadGatewayManager()
    const manager = new GatewayManager('default')

    expect(manager.getApiKeyForUpstream('default')).toBe('config-local-key')
  })

  it('keeps remote registry apiKeyEnv routing ahead of profile config', async () => {
    process.env.MINION59_API_SERVER_KEY = 'remote-env-key'
    mkdirSync(join(hermesHome, 'profiles', 'remote-peer'), { recursive: true })
    writeFileSync(join(hermesHome, 'profiles', 'remote-peer', 'config.yaml'), [
      'platforms:',
      '  api_server:',
      '    key: wrong-profile-key',
      '',
    ].join('\n'), 'utf-8')
    writeFileSync(join(stateDir, 'gateways.json'), JSON.stringify({
      gateways: [{
        id: 'remote-peer',
        profile: 'remote-peer',
        type: 'remote',
        displayName: 'Minion59',
        upstream: 'http://203.0.113.59:8642',
        apiKeyEnv: 'MINION59_API_SERVER_KEY',
      }],
    }), 'utf-8')

    const GatewayManager = await loadGatewayManager()
    const manager = new GatewayManager('default')

    expect(manager.getApiKeyForUpstream('remote-peer')).toBe('remote-env-key')
  })

  it('hydrates local gateway child env from profile .env without overriding exported env', async () => {
    writeFileSync(join(hermesHome, '.env'), [
      'REMOTE_GATEWAY_API_KEY=profile-nas-key',
      'EXPORTED_KEY=profile-should-not-win',
      'QUOTED_KEY="quoted-value"',
      'export EXPORTED_STYLE=from-profile',
      '',
    ].join('\n'), 'utf-8')

    const { buildGatewayChildEnv } = await loadGatewayManagerModule()
    const env = buildGatewayChildEnv(hermesHome, {
      EXPORTED_KEY: 'exported-wins',
      HERMES_HOME: '/old/home',
    })

    expect(env.REMOTE_GATEWAY_API_KEY).toBe('profile-nas-key')
    expect(env.EXPORTED_KEY).toBe('exported-wins')
    expect(env.QUOTED_KEY).toBe('quoted-value')
    expect(env.EXPORTED_STYLE).toBe('from-profile')
    expect(env.HERMES_HOME).toBe(hermesHome)
  })

  it('does not mark a profile running when another PID owns the configured local port', async () => {
    writeFileSync(join(hermesHome, 'config.yaml'), [
      'platforms:',
      '  api_server:',
      '    extra:',
      '      host: 0.0.0.0',
      '      port: 8642',
      '',
    ].join('\n'), 'utf-8')
    writeFileSync(join(hermesHome, 'gateway.pid'), JSON.stringify({ pid: 38597 }), 'utf-8')

    const GatewayManager = await loadGatewayManager()
    const manager = new GatewayManager('default') as any
    manager.isProcessAlive = vi.fn(() => true)
    manager.checkHealth = vi.fn(() => Promise.resolve(true))
    manager.getListeningPids = vi.fn(() => Promise.resolve([73497]))

    await expect(manager.detectStatus('default')).resolves.toMatchObject({
      profile: 'default',
      port: 8642,
      host: '0.0.0.0',
      running: false,
    })
  })

  it('lists only managed local gateway profiles for normal runtime status', async () => {
    mkdirSync(join(hermesHome, 'profiles', 'test111'), { recursive: true })
    mkdirSync(join(hermesHome, 'profiles', 'project-a'), { recursive: true })
    writeFileSync(join(hermesHome, 'config.yaml'), 'platforms:\n  api_server:\n    extra:\n      host: 127.0.0.1\n      port: 8642\n', 'utf-8')
    writeFileSync(join(hermesHome, 'profiles', 'test111', 'config.yaml'), 'platforms:\n  api_server:\n    extra:\n      host: 127.0.0.1\n      port: 8642\n', 'utf-8')
    writeFileSync(join(hermesHome, 'profiles', 'project-a', 'config.yaml'), 'platforms:\n  api_server:\n    extra:\n      host: 127.0.0.1\n      port: 8643\n', 'utf-8')
    writeFileSync(join(stateDir, 'gateways.json'), JSON.stringify({
      gateways: [
        { id: 'local-default', profile: 'default', type: 'local', displayName: 'Local default' },
        { id: 'project-a', profile: 'project-a', type: 'local', displayName: 'Project A' },
      ],
    }), 'utf-8')

    const GatewayManager = await loadGatewayManager()
    const manager = new GatewayManager('default') as any
    manager.listProfiles = vi.fn(() => Promise.resolve(['default', 'test111', 'project-a']))
    manager.detectStatus = vi.fn((profile: string) => Promise.resolve({ profile, running: false }))

    await expect(manager.listAll()).resolves.toEqual([
      { profile: 'default', running: false },
      { profile: 'project-a', running: false },
    ])
    expect(manager.detectStatus).not.toHaveBeenCalledWith('test111')
  })

})
