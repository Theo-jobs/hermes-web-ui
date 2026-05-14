import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { logger } from '../logger'

export type GatewayRegistryType = 'local' | 'remote' | 'custom'

export interface GatewayRegistryEntry {
  id: string
  profile: string
  type: GatewayRegistryType
  displayName: string
  upstream?: string
  apiKeyEnv?: string
  defaultModel?: string
  spaceId?: string
  readonly?: boolean
}

export interface SpaceRegistryEntry {
  id: string
  displayName: string
  gatewayId: string
  profile: string
}

interface GatewayRegistryFile {
  gateways: GatewayRegistryEntry[]
}

interface SpaceRegistryFile {
  spaces: SpaceRegistryEntry[]
}

const DEFAULT_GATEWAYS_FILE = 'gateways.json'
const DEFAULT_SPACES_FILE = 'spaces.json'
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const ENV_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

function getStateDir(): string {
  return resolve(process.env.HERMES_WEB_UI_STATE_DIR || process.env.HERMES_WEB_UI_DATA_DIR || join(homedir(), '.hermes-web-ui'))
}

function gatewaysPath(): string {
  return join(getStateDir(), DEFAULT_GATEWAYS_FILE)
}

function spacesPath(): string {
  return join(getStateDir(), DEFAULT_SPACES_FILE)
}

function remoteEnvPath(): string {
  return join(getStateDir(), '.remote-agents.env')
}

function ensureDir() {
  mkdirSync(getStateDir(), { recursive: true })
}

function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch (err) {
    logger.warn(err, '[gateway-registry] ignoring unreadable registry file %s', path)
    return fallback
  }
}

function writeJsonFile(path: string, data: unknown) {
  ensureDir()
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  const content = readFileSync(path, 'utf-8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    out[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return out
}

function normalizeOptionalString(value: unknown, field: string, maxLength = 512): string | undefined {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.length > maxLength) throw new Error(`${field} is too long`)
  return trimmed
}

function normalizeName(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  const trimmed = value.trim()
  if (!NAME_PATTERN.test(trimmed)) {
    throw new Error(`${field} must match ${NAME_PATTERN.source}`)
  }
  return trimmed
}

function normalizeGateway(input: unknown, existing?: GatewayRegistryEntry): GatewayRegistryEntry {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('gateway payload must be an object')
  }
  const body = input as Record<string, unknown>
  if ('apiKey' in body || 'key' in body || 'secret' in body || 'api_key' in body) {
    throw new Error('raw secrets are not accepted; use apiKeyEnv')
  }

  const id = normalizeName(body.id ?? existing?.id, 'id')
  const profile = normalizeName(body.profile ?? existing?.profile ?? id, 'profile')
  const typeRaw = normalizeOptionalString(body.type, 'type') || existing?.type || 'custom'
  if (!['local', 'remote', 'custom'].includes(typeRaw)) {
    throw new Error('type must be local, remote, or custom')
  }
  const apiKeyEnv = normalizeOptionalString(body.apiKeyEnv ?? existing?.apiKeyEnv, 'apiKeyEnv', 128)
  if (apiKeyEnv && !ENV_PATTERN.test(apiKeyEnv)) {
    throw new Error('apiKeyEnv must be an environment variable name')
  }

  const upstream = normalizeOptionalString(body.upstream ?? existing?.upstream, 'upstream')
  if (upstream) {
    try {
      const url = new URL(upstream)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid protocol')
    } catch {
      throw new Error('upstream must be an http(s) URL')
    }
  }

  return {
    id,
    profile,
    type: typeRaw as GatewayRegistryType,
    displayName: normalizeOptionalString(body.displayName ?? existing?.displayName, 'displayName', 128) || id,
    upstream,
    apiKeyEnv,
    defaultModel: normalizeOptionalString(body.defaultModel ?? existing?.defaultModel, 'defaultModel', 256),
    spaceId: normalizeOptionalString(body.spaceId ?? existing?.spaceId, 'spaceId', 64),
    readonly: Boolean(body.readonly ?? existing?.readonly ?? false),
  }
}

function redactGateway(entry: GatewayRegistryEntry): GatewayRegistryEntry & { hasApiKey: boolean } {
  return {
    ...entry,
    hasApiKey: !!(entry.apiKeyEnv && (process.env[entry.apiKeyEnv] || parseEnvFile(remoteEnvPath())[entry.apiKeyEnv])),
  }
}

function seedGateways(): GatewayRegistryEntry[] {
  const remoteEnv = parseEnvFile(remoteEnvPath())
  const gateways: GatewayRegistryEntry[] = [
    {
      id: 'local-default',
      profile: 'default',
      type: 'local',
      displayName: 'Local default',
      spaceId: 'daily-mac',
    },
  ]

  const hefengUpstream = process.env.HEFENG_UPSTREAM || remoteEnv.HEFENG_UPSTREAM
  const hefengKeyPresent = !!(process.env.HEFENG_API_SERVER_KEY || remoteEnv.HEFENG_API_SERVER_KEY)
  if (hefengUpstream || hefengKeyPresent) {
    gateways.push({
      id: 'hefeng',
      profile: 'hefeng',
      type: 'remote',
      displayName: 'Hefeng remote',
      upstream: hefengUpstream,
      apiKeyEnv: 'HEFENG_API_SERVER_KEY',
      spaceId: 'hefeng-work',
      readonly: true,
    })
  }

  return gateways
}

function seedSpaces(gateways: GatewayRegistryEntry[]): SpaceRegistryEntry[] {
  const hasHefeng = gateways.some(g => g.id === 'hefeng')
  const spaces: SpaceRegistryEntry[] = [
    {
      id: 'daily-mac',
      displayName: 'Daily Mac',
      gatewayId: 'local-default',
      profile: 'default',
    },
  ]
  if (hasHefeng) {
    spaces.push({
      id: 'hefeng-work',
      displayName: 'Hefeng Work',
      gatewayId: 'hefeng',
      profile: 'hefeng',
    })
  }
  return spaces
}

export class GatewayRegistryService {
  private ensureGatewayFile(): GatewayRegistryFile {
    const path = gatewaysPath()
    if (!existsSync(path)) {
      const seeded = { gateways: seedGateways() }
      writeJsonFile(path, seeded)
      return seeded
    }
    const data = readJsonFile<GatewayRegistryFile>(path, { gateways: [] })
    if (!Array.isArray(data.gateways)) return { gateways: [] }
    const gateways: GatewayRegistryEntry[] = []
    for (const item of data.gateways) {
      try {
        gateways.push(normalizeGateway(item))
      } catch (err) {
        logger.warn(err, '[gateway-registry] skipping invalid gateway entry')
      }
    }
    return { gateways }
  }

  private writeGatewayFile(gateways: GatewayRegistryEntry[]) {
    writeJsonFile(gatewaysPath(), { gateways })
  }

  private ensureSpaceFile(): SpaceRegistryFile {
    const path = spacesPath()
    if (!existsSync(path)) {
      const spaces = seedSpaces(this.ensureGatewayFile().gateways)
      const seeded = { spaces }
      writeJsonFile(path, seeded)
      return seeded
    }
    const data = readJsonFile<SpaceRegistryFile>(path, { spaces: [] })
    return {
      spaces: Array.isArray(data.spaces)
        ? data.spaces
          .map(space => ({
            id: normalizeName((space as any).id, 'id'),
            displayName: normalizeOptionalString((space as any).displayName, 'displayName', 128) || (space as any).id,
            gatewayId: normalizeName((space as any).gatewayId, 'gatewayId'),
            profile: normalizeName((space as any).profile, 'profile'),
          }))
        : [],
    }
  }

  listGateways() {
    return this.ensureGatewayFile().gateways.map(redactGateway)
  }

  listSpaces() {
    return this.ensureSpaceFile().spaces
  }

  upsertGateway(input: unknown) {
    const file = this.ensureGatewayFile()
    const requestedId = input && typeof input === 'object' ? (input as any).id : undefined
    const existing = requestedId ? file.gateways.find(g => g.id === requestedId) : undefined
    const gateway = normalizeGateway(input, existing)
    const index = file.gateways.findIndex(g => g.id === gateway.id)
    if (index >= 0) file.gateways[index] = gateway
    else file.gateways.push(gateway)
    this.writeGatewayFile(file.gateways)
    return redactGateway(gateway)
  }

  deleteGateway(id: string) {
    const gatewayId = normalizeName(id, 'id')
    const file = this.ensureGatewayFile()
    const gateway = file.gateways.find(g => g.id === gatewayId)
    if (!gateway) return false
    if (gateway.readonly) throw new Error('readonly gateway cannot be deleted')
    this.writeGatewayFile(file.gateways.filter(g => g.id !== gatewayId))
    return true
  }

  getGateway(id: string) {
    const gatewayId = normalizeName(id, 'id')
    return this.ensureGatewayFile().gateways.find(g => g.id === gatewayId) || null
  }

  async testGateway(id: string, timeoutMs = 3000, fallback?: { upstream?: string; apiKey?: string | null }) {
    const gateway = this.getGateway(id)
    if (!gateway) throw new Error('gateway not found')
    const upstream = gateway.upstream || fallback?.upstream
    if (!upstream) {
      return { ok: false, status: 0, error: 'gateway has no upstream URL', gateway: redactGateway(gateway) }
    }

    const headers: Record<string, string> = {}
    const env = gateway.apiKeyEnv ? (process.env[gateway.apiKeyEnv] || parseEnvFile(remoteEnvPath())[gateway.apiKeyEnv]) : ''
    const apiKey = env || fallback?.apiKey || ''
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    try {
      const res = await fetch(`${upstream.replace(/\/+$/, '')}/health`, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      })
      return { ok: res.ok, status: res.status, gateway: redactGateway(gateway) }
    } catch (err: any) {
      return { ok: false, status: 0, error: err?.message || 'health check failed', gateway: redactGateway(gateway) }
    }
  }
}

export const gatewayRegistryService = new GatewayRegistryService()
