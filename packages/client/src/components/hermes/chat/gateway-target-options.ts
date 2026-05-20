import type { AvailableModelGroup, ProfileAvailableModels } from '@/api/hermes/system'
import type { GatewayRegistryEntry, SpaceRegistryEntry } from '@/api/hermes/gateway-registry'

export type GatewayTargetOption = {
  label: string
  value: string
  displayName: string
  gatewayName: string
  profile: string
  spaceId: string | null
  gatewayId: string | null
  defaultModel: string | null
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
  if (targetDefaultModel && !groups.some(group => group.models.includes(targetDefaultModel))) {
    addModelToProvider(
      groups,
      profileDefaultProvider || selectedProvider || ctx.profile || 'custom',
      targetDefaultModel,
    )
  }

  return groups.filter(group => group.models.length > 0)
}

export function resolveModelSelectionForGatewayTarget(ctx: TargetModelContext): ModelSelection {
  const groups = getModelGroupsForGatewayTarget(ctx)
  const profileModels = ctx.profileModelGroups.find(entry => entry.profile === ctx.profile)
  const preferredModels = [
    ctx.defaultModel?.trim() || '',
    profileModels?.default?.trim() || '',
    ctx.selectedModel?.trim() || '',
  ].filter(Boolean)

  for (const preferred of preferredModels) {
    const preferredGroup = groups.find(group => group.models.includes(preferred))
    if (preferredGroup) return { provider: preferredGroup.provider, model: preferred }
  }

  const preferredProviders = [
    profileModels?.default_provider?.trim() || '',
    ctx.selectedProvider?.trim() || '',
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
  label: string
  displayName?: string
  gatewayName?: string
  defaultModel?: string | null
  fallback?: boolean
} & Omit<TargetModelContext, 'profile' | 'defaultModel'>): GatewayTargetOption {
  const selection = resolveModelSelectionForGatewayTarget({
    profile: params.profile,
    defaultModel: params.defaultModel,
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
    value: params.spaceId || `profile:${params.profile}`,
    profile: params.profile,
    spaceId: params.spaceId || null,
    gatewayId: params.gatewayId || null,
    defaultModel: params.defaultModel || null,
    provider: selection.provider,
    model: selection.model,
    fallback: params.fallback,
  }
}

export function buildGatewayTargetOptions(ctx: TargetOptionContext): GatewayTargetOption[] {
  const gatewayById = new Map(ctx.gateways.map(gateway => [gateway.id, gateway]))
  const seenProfiles = new Set<string>()
  const options: GatewayTargetOption[] = []

  for (const space of ctx.spaces) {
    seenProfiles.add(space.profile)
    const gateway = gatewayById.get(space.gatewayId)
    options.push(buildGatewayTargetOption({
      profile: space.profile,
      spaceId: space.id,
      gatewayId: space.gatewayId,
      label: `${space.displayName} / ${gateway?.displayName || gateway?.id || space.gatewayId || space.profile} / ${space.profile}`,
      displayName: space.displayName,
      gatewayName: gateway?.displayName || gateway?.id || space.gatewayId || space.profile,
      defaultModel: gateway?.defaultModel || null,
      profileModelGroups: ctx.profileModelGroups,
      globalModelGroups: ctx.globalModelGroups,
      customModels: ctx.customModels,
      selectedProvider: ctx.selectedProvider,
      selectedModel: ctx.selectedModel,
    }))
  }

  for (const gateway of ctx.gateways) {
    if (seenProfiles.has(gateway.profile)) continue
    options.push(buildGatewayTargetOption({
      profile: gateway.profile,
      gatewayId: gateway.id,
      label: `${gateway.displayName || gateway.id} / ${gateway.profile}`,
      displayName: gateway.displayName || gateway.id,
      gatewayName: gateway.displayName || gateway.id,
      defaultModel: gateway.defaultModel || null,
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
