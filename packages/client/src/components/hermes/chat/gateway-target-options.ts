import type { AvailableModelGroup, ProfileAvailableModels } from '@/api/hermes/system'
import type { GatewayRegistryEntry, GatewayRegistryType, SpaceRegistryEntry } from '@/api/hermes/gateway-registry'

export type GatewayTargetRunSource = 'cli' | 'api_server'

export type GatewayTargetOption = {
  label: string
  value: string
  displayName: string
  gatewayName: string
  gatewayType: GatewayRegistryType | 'fallback'
  source: GatewayTargetRunSource
  profile: string
  spaceId: string | null
  gatewayId: string | null
  defaultModel: string | null
  searchText: string
  provider: string
  model: string
  fallback?: boolean
}

type ModelSelection = {
  provider: string
  model: string
}

type ModelGroup = Pick<AvailableModelGroup, 'provider' | 'label' | 'models'>

type TargetModelContext = {
  profile: string
  defaultModel?: string | null
  defaultProvider?: string | null
  profileModelGroups: ProfileAvailableModels[]
  globalModelGroups: AvailableModelGroup[]
  customModels?: Record<string, string[]>
  selectedProvider?: string | null
  selectedModel?: string | null
}

type TargetOptionContext = Omit<TargetModelContext, 'profile' | 'defaultModel'> & {
  gateways: GatewayRegistryEntry[]
  spaces: SpaceRegistryEntry[]
  fallbackProfile: string
}

function uniqueModels(models: string[]): string[] {
  return [...new Set(models.filter(Boolean))]
}

function cloneGroup(group: ModelGroup): AvailableModelGroup {
  return {
    ...(group as AvailableModelGroup),
    provider: group.provider,
    label: group.label || group.provider,
    models: uniqueModels(group.models || []),
    base_url: (group as AvailableModelGroup).base_url || '',
    api_key: (group as AvailableModelGroup).api_key || '',
  }
}

function upsertGroup(groups: AvailableModelGroup[], group: ModelGroup) {
  if (!group.provider) return
  const existing = groups.find(item => item.provider === group.provider)
  if (existing) {
    existing.label = existing.label || group.label || group.provider
    existing.models = uniqueModels([...existing.models, ...(group.models || [])])
    return
  }
  groups.push(cloneGroup(group))
}

function addModelToProvider(groups: AvailableModelGroup[], provider: string, model: string) {
  if (!provider || !model) return
  const existing = groups.find(group => group.provider === provider)
  if (existing) {
    existing.models = uniqueModels([...existing.models, model])
    if (!existing.label) existing.label = provider
    return
  }
  groups.push({
    provider,
    label: provider,
    base_url: '',
    api_key: '',
    models: [model],
  })
}

function gatewayRunSource(gateway?: GatewayRegistryEntry | null): GatewayTargetRunSource {
  return gateway?.upstream || gateway?.type === 'remote' ? 'api_server' : 'cli'
}

export function getModelGroupsForGatewayTarget(ctx: TargetModelContext): AvailableModelGroup[] {
  const profileModels = ctx.profileModelGroups.find(entry => entry.profile === ctx.profile)
  const groups: AvailableModelGroup[] = []

  for (const group of profileModels?.groups || []) upsertGroup(groups, group)
  for (const group of ctx.globalModelGroups) upsertGroup(groups, group)
  for (const [provider, models] of Object.entries(ctx.customModels || {})) {
    upsertGroup(groups, { provider, label: provider, models })
  }

  const selectedProvider = ctx.selectedProvider?.trim() || ''
  const selectedModel = ctx.selectedModel?.trim() || ''
  if (selectedProvider && selectedModel) addModelToProvider(groups, selectedProvider, selectedModel)

  const profileDefaultProvider = profileModels?.default_provider?.trim() || ''
  const profileDefaultModel = profileModels?.default?.trim() || ''
  if (profileDefaultProvider && profileDefaultModel) {
    addModelToProvider(groups, profileDefaultProvider, profileDefaultModel)
  }

  const targetDefaultModel = ctx.defaultModel?.trim() || ''
  const targetDefaultProvider = ctx.defaultProvider?.trim() || ''
  if (targetDefaultModel && !groups.some(group => group.models.includes(targetDefaultModel))) {
    addModelToProvider(
      groups,
      targetDefaultProvider || profileDefaultProvider || selectedProvider || ctx.profile || 'custom',
      targetDefaultModel,
    )
  }
  if (targetDefaultProvider && targetDefaultModel) {
    addModelToProvider(groups, targetDefaultProvider, targetDefaultModel)
  }

  return groups.filter(group => group.models.length > 0)
}

export function resolveModelSelectionForGatewayTarget(ctx: TargetModelContext): ModelSelection {
  const groups = getModelGroupsForGatewayTarget(ctx)
  const profileModels = ctx.profileModelGroups.find(entry => entry.profile === ctx.profile)
  const targetDefaultProvider = ctx.defaultProvider?.trim() || ''
  const targetDefaultModel = ctx.defaultModel?.trim() || ''
  const profileDefaultProvider = profileModels?.default_provider?.trim() || ''
  const profileDefaultModel = profileModels?.default?.trim() || ''
  const selectedProvider = ctx.selectedProvider?.trim() || ''
  const selectedModel = ctx.selectedModel?.trim() || ''

  const exactPairs = [
    { provider: targetDefaultProvider, model: targetDefaultModel },
    { provider: profileDefaultProvider, model: profileDefaultModel },
  ]
  for (const pair of exactPairs) {
    if (!pair.provider || !pair.model) continue
    const exactGroup = groups.find(group => group.provider === pair.provider && group.models.includes(pair.model))
    if (exactGroup) return { provider: exactGroup.provider, model: pair.model }
  }

  const preferredModels = [
    targetDefaultModel,
    profileDefaultModel,
    selectedModel,
  ].filter(Boolean)

  for (const preferred of preferredModels) {
    const preferredGroup = groups.find(group => group.models.includes(preferred))
    if (preferredGroup) return { provider: preferredGroup.provider, model: preferred }
  }

  const preferredProviders = [
    targetDefaultProvider,
    profileDefaultProvider,
    selectedProvider,
  ].filter(Boolean)
  for (const provider of preferredProviders) {
    const providerGroup = groups.find(group => group.provider === provider && group.models.length > 0)
    if (providerGroup) return { provider: providerGroup.provider, model: providerGroup.models[0] }
  }

  const fallbackGroup = groups.find(group => group.models.length > 0)
  return { provider: fallbackGroup?.provider || '', model: fallbackGroup?.models[0] || '' }
}

export function buildGatewayTargetOption(params: {
  profile: string
  spaceId?: string | null
  gatewayId?: string | null
  gatewayType?: GatewayRegistryType | 'fallback'
  label: string
  displayName?: string
  gatewayName?: string
  source?: GatewayTargetRunSource
  defaultModel?: string | null
  defaultProvider?: string | null
  fallback?: boolean
} & Omit<TargetModelContext, 'profile' | 'defaultModel'>): GatewayTargetOption {
  const selection = resolveModelSelectionForGatewayTarget({
    profile: params.profile,
    defaultModel: params.defaultModel,
    defaultProvider: params.defaultProvider,
    profileModelGroups: params.profileModelGroups,
    globalModelGroups: params.globalModelGroups,
    customModels: params.customModels,
    selectedProvider: params.selectedProvider,
    selectedModel: params.selectedModel,
  })
  return {
    label: params.label,
    displayName: params.displayName || params.label,
    gatewayName: params.gatewayName || params.gatewayId || params.profile,
    gatewayType: params.gatewayType || 'custom',
    source: params.source || 'cli',
    value: params.spaceId || (params.gatewayId ? `gateway:${params.gatewayId}` : `profile:${params.profile}`),
    profile: params.profile,
    spaceId: params.spaceId || null,
    gatewayId: params.gatewayId || null,
    defaultModel: params.defaultModel || null,
    searchText: [
      params.label,
      params.displayName,
      params.gatewayName,
      params.gatewayId,
      params.profile,
      params.defaultModel,
      params.defaultProvider,
    ].filter(Boolean).join(' ').toLowerCase(),
    provider: selection.provider,
    model: selection.model,
    fallback: params.fallback,
  }
}

export function buildGatewayTargetOptions(ctx: TargetOptionContext): GatewayTargetOption[] {
  const gatewayById = new Map(ctx.gateways.map(gateway => [gateway.id, gateway]))
  const seenGatewayIds = new Set<string>()
  const options: GatewayTargetOption[] = []

  for (const space of ctx.spaces) {
    seenGatewayIds.add(space.gatewayId)
    const gateway = gatewayById.get(space.gatewayId)
    options.push(buildGatewayTargetOption({
      profile: space.profile,
      spaceId: space.id,
      gatewayId: space.gatewayId,
      gatewayType: gateway?.type || 'custom',
      source: gatewayRunSource(gateway),
      label: `${space.displayName} / ${gateway?.displayName || gateway?.id || space.gatewayId || space.profile} / ${space.profile}`,
      displayName: space.displayName,
      gatewayName: gateway?.displayName || gateway?.id || space.gatewayId || space.profile,
      defaultModel: gateway?.defaultModel || null,
      defaultProvider: gateway?.provider || null,
      profileModelGroups: ctx.profileModelGroups,
      globalModelGroups: ctx.globalModelGroups,
      customModels: ctx.customModels,
      selectedProvider: ctx.selectedProvider,
      selectedModel: ctx.selectedModel,
    }))
  }

  for (const gateway of ctx.gateways) {
    if (seenGatewayIds.has(gateway.id)) continue
    options.push(buildGatewayTargetOption({
      profile: gateway.profile,
      gatewayId: gateway.id,
      gatewayType: gateway.type || 'custom',
      source: gatewayRunSource(gateway),
      label: `${gateway.displayName || gateway.id} / ${gateway.profile}`,
      displayName: gateway.displayName || gateway.id,
      gatewayName: gateway.displayName || gateway.id,
      defaultModel: gateway.defaultModel || null,
      defaultProvider: gateway.provider || null,
      profileModelGroups: ctx.profileModelGroups,
      globalModelGroups: ctx.globalModelGroups,
      customModels: ctx.customModels,
      selectedProvider: ctx.selectedProvider,
      selectedModel: ctx.selectedModel,
    }))
  }

  if (options.length === 0) {
    const profile = ctx.fallbackProfile || 'default'
    options.push(buildGatewayTargetOption({
      profile,
      label: `${profile} / current default`,
      displayName: profile,
      gatewayName: 'current default',
      gatewayType: 'fallback',
      source: 'cli',
      fallback: true,
      profileModelGroups: ctx.profileModelGroups,
      globalModelGroups: ctx.globalModelGroups,
      customModels: ctx.customModels,
      selectedProvider: ctx.selectedProvider,
      selectedModel: ctx.selectedModel,
    }))
  }

  return options
}
