import { request } from '../client'

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
  hasApiKey?: boolean
}

export interface SpaceRegistryEntry {
  id: string
  displayName: string
  gatewayId: string
  profile: string
}

export async function fetchGatewayRegistry(): Promise<GatewayRegistryEntry[]> {
  const res = await request<{ gateways: GatewayRegistryEntry[] }>('/api/hermes/gateway-registry')
  return res.gateways
}

export async function upsertGatewayRegistryEntry(gateway: Partial<GatewayRegistryEntry> & { id: string }): Promise<GatewayRegistryEntry> {
  const res = await request<{ gateway: GatewayRegistryEntry }>(`/api/hermes/gateway-registry/${encodeURIComponent(gateway.id)}`, {
    method: 'PUT',
    body: JSON.stringify(gateway),
  })
  return res.gateway
}

export async function deleteGatewayRegistryEntry(id: string): Promise<void> {
  await request(`/api/hermes/gateway-registry/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function testGatewayRegistryEntry(id: string): Promise<{ ok: boolean; status: number; error?: string; gateway: GatewayRegistryEntry }> {
  return request(`/api/hermes/gateway-registry/${encodeURIComponent(id)}/health`)
}

export async function fetchSpaces(): Promise<SpaceRegistryEntry[]> {
  const res = await request<{ spaces: SpaceRegistryEntry[] }>('/api/hermes/spaces')
  return res.spaces
}

