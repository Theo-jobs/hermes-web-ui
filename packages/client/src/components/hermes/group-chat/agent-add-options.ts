import type { SelectOption } from 'naive-ui'
import type { GatewayRegistryEntry } from '@/api/hermes/gateway-registry'

export interface AgentAddProfileOption extends SelectOption {
  label: string
  value: string
  source: 'gateway' | 'profile'
}

export interface AgentAddDefaults {
  name: string
  description: string
}

export function formatGatewayAddLabel(entry: Pick<GatewayRegistryEntry, 'displayName' | 'profile' | 'type' | 'hasApiKey' | 'upstream'>): string {
  const parts = [entry.displayName || entry.profile]
  if (entry.profile && entry.profile !== entry.displayName) parts.push(entry.profile)
  if (entry.type) parts.push(entry.type)
  if (entry.hasApiKey !== undefined) parts.push(entry.hasApiKey ? 'api-key' : 'no-api-key')
  return parts.join(' · ')
}

export function buildAgentAddProfileOptions(
  gateways: GatewayRegistryEntry[],
  profiles: { name: string }[],
): AgentAddProfileOption[] {
  const gatewayProfiles = new Set(gateways.map(gateway => gateway.profile))
  const gatewayOptions = gateways.map(gateway => ({
    label: formatGatewayAddLabel(gateway),
    value: gateway.profile,
    source: 'gateway' as const,
  }))
  const fallbackProfileOptions = profiles
    .filter(profile => !gatewayProfiles.has(profile.name))
    .map(profile => ({
      label: profile.name,
      value: profile.name,
      source: 'profile' as const,
    }))
  return [...gatewayOptions, ...fallbackProfileOptions]
}

export function deriveAgentAddDefaults(
  selectedProfile: string | null,
  gateways: GatewayRegistryEntry[],
  profiles: { name: string }[],
  current: AgentAddDefaults,
): AgentAddDefaults {
  const gateway = gateways.find(item => item.profile === selectedProfile)
  if (gateway) {
    return {
      name: current.name.trim() ? current.name : (gateway.displayName || gateway.profile),
      description: current.description.trim()
        ? current.description
        : [gateway.upstream?.trim(), gateway.type?.trim()].filter(Boolean).join(' · ') || gateway.profile,
    }
  }

  const profile = profiles.find(item => item.name === selectedProfile)
  if (profile) {
    return {
      name: current.name.trim() ? current.name : profile.name,
      description: current.description.trim() ? current.description : profile.name,
    }
  }

  return current
}
