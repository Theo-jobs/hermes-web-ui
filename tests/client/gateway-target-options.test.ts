// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  buildGatewayTargetOptions,
  getModelGroupsForGatewayTarget,
  resolveModelSelectionForGatewayTarget,
} from '@/components/hermes/chat/gateway-target-options'
import type { AvailableModelGroup, ProfileAvailableModels } from '@/api/hermes/system'

const globalGroups: AvailableModelGroup[] = [
  { provider: 'custom:nas', label: 'NAS', base_url: '', api_key: '', models: ['nas-default', 'nas-large'] },
  { provider: 'xai', label: 'xAI', base_url: '', api_key: '', models: ['grok-4.3'] },
]

describe('gateway target option helpers', () => {
  it('derives visible gateway options from spaces and gateways with a default fallback', () => {
    const options = buildGatewayTargetOptions({
      gateways: [
        { id: 'local-default', profile: 'default', type: 'local', displayName: 'Local default', defaultModel: 'nas-default' },
        { id: 'hefeng', profile: 'hefeng', type: 'remote', displayName: 'Hefeng remote', defaultModel: 'hefeng-model' },
        { id: 'minion59', profile: 'minion59', type: 'remote', displayName: '小赫59 remote', defaultModel: 'minion-model' },
      ],
      spaces: [
        { id: 'daily-mac', displayName: 'Daily Mac', gatewayId: 'local-default', profile: 'default' },
        { id: 'hefeng-work', displayName: 'Hefeng Work', gatewayId: 'hefeng', profile: 'hefeng' },
        { id: 'minion59-work', displayName: '小赫59 Work', gatewayId: 'minion59', profile: 'minion59' },
      ],
      fallbackProfile: 'default',
      profileModelGroups: [],
      globalModelGroups: globalGroups,
      selectedProvider: 'custom:nas',
      selectedModel: 'nas-default',
    })

    expect(options.map(option => option.label)).toEqual([
      'Daily Mac / Local default / default',
      'Hefeng Work / Hefeng remote / hefeng',
      '小赫59 Work / 小赫59 remote / minion59',
    ])
    expect(options[0]).toMatchObject({
      value: 'daily-mac',
      profile: 'default',
      spaceId: 'daily-mac',
      displayName: 'Daily Mac',
      gatewayName: 'Local default',
      provider: 'custom:nas',
      model: 'nas-default',
    })

    const fallback = buildGatewayTargetOptions({
      gateways: [],
      spaces: [],
      fallbackProfile: 'default',
      profileModelGroups: [],
      globalModelGroups: globalGroups,
      selectedProvider: 'custom:nas',
      selectedModel: 'nas-default',
    })
    expect(fallback[0]).toMatchObject({ value: 'profile:default', profile: 'default', fallback: true })
    expect(fallback[0].label).toContain('default')
  })

  it('uses global and custom model groups when a selected profile has no profile-specific groups', () => {
    const groups = getModelGroupsForGatewayTarget({
      profile: 'hefeng',
      defaultModel: 'remote-special',
      profileModelGroups: [],
      globalModelGroups: globalGroups,
      customModels: { 'custom:remote': ['remote-special'] },
      selectedProvider: 'custom:nas',
      selectedModel: 'nas-default',
    })

    expect(groups.map(group => group.provider)).toEqual(['custom:nas', 'xai', 'custom:remote'])
    expect(groups.find(group => group.provider === 'custom:remote')?.models).toContain('remote-special')
    expect(resolveModelSelectionForGatewayTarget({
      profile: 'hefeng',
      defaultModel: 'remote-special',
      profileModelGroups: [],
      globalModelGroups: globalGroups,
      customModels: { 'custom:remote': ['remote-special'] },
      selectedProvider: 'custom:nas',
      selectedModel: 'nas-default',
    })).toEqual({ provider: 'custom:remote', model: 'remote-special' })
  })

  it('uses the gateway provider for a gateway default model', () => {
    const options = buildGatewayTargetOptions({
      gateways: [
        {
          id: 'hefeng',
          profile: 'hefeng',
          type: 'remote',
          displayName: 'Hefeng',
          provider: 'custom:hefeng',
          defaultModel: 'hefeng-model',
        },
      ],
      spaces: [
        { id: 'hefeng-work', displayName: 'Hefeng Work', gatewayId: 'hefeng', profile: 'hefeng' },
      ],
      fallbackProfile: 'default',
      profileModelGroups: [],
      globalModelGroups: globalGroups,
      selectedProvider: 'custom:nas',
      selectedModel: 'nas-default',
    })

    expect(options[0]).toMatchObject({
      profile: 'hefeng',
      spaceId: 'hefeng-work',
      gatewayType: 'remote',
      source: 'api_server',
      provider: 'custom:hefeng',
      model: 'hefeng-model',
      defaultModel: 'hefeng-model',
    })
  })

  it('routes custom gateways with upstreams through api server and local gateways through cli', () => {
    const options = buildGatewayTargetOptions({
      gateways: [
        { id: 'local-default', profile: 'default', type: 'local', displayName: 'Local' },
        { id: 'custom-remote', profile: 'customRemote', type: 'custom', displayName: 'Custom Remote', upstream: 'https://example.test' },
      ],
      spaces: [],
      fallbackProfile: 'default',
      profileModelGroups: [],
      globalModelGroups: globalGroups,
      selectedProvider: 'custom:nas',
      selectedModel: 'nas-default',
    })

    expect(options.find(option => option.gatewayName === 'Local')?.source).toBe('cli')
    expect(options.find(option => option.gatewayName === 'Custom Remote')?.source).toBe('api_server')
  })

  it('keeps the gateway provider when the default model exists in multiple providers', () => {
    expect(resolveModelSelectionForGatewayTarget({
      profile: 'hefeng',
      defaultProvider: 'custom:hefeng',
      defaultModel: 'shared-model',
      profileModelGroups: [],
      globalModelGroups: [
        { provider: 'custom:nas', label: 'NAS', base_url: '', api_key: '', models: ['shared-model'] },
        { provider: 'custom:hefeng', label: 'Hefeng', base_url: '', api_key: '', models: ['shared-model'] },
      ],
      selectedProvider: 'custom:nas',
      selectedModel: 'shared-model',
    })).toEqual({ provider: 'custom:hefeng', model: 'shared-model' })
  })

  it('keeps gateway-only targets distinct from profile fallbacks', () => {
    const options = buildGatewayTargetOptions({
      gateways: [
        { id: 'remote-one', profile: 'remote-agent', type: 'remote', displayName: 'Remote One' },
        { id: 'remote-two', profile: 'remote-agent', type: 'remote', displayName: 'Remote Two' },
      ],
      spaces: [],
      fallbackProfile: 'default',
      profileModelGroups: [],
      globalModelGroups: globalGroups,
      selectedProvider: 'custom:nas',
      selectedModel: 'nas-default',
    })

    expect(options.map(option => option.value)).toEqual(['gateway:remote-one', 'gateway:remote-two'])
  })

  it('does not hide gateway-only targets when another gateway with the same profile has a space', () => {
    const options = buildGatewayTargetOptions({
      gateways: [
        { id: 'remote-one', profile: 'remote-agent', type: 'remote', displayName: 'Remote One' },
        { id: 'remote-two', profile: 'remote-agent', type: 'remote', displayName: 'Remote Two' },
      ],
      spaces: [
        { id: 'remote-one-work', displayName: 'Remote One Work', gatewayId: 'remote-one', profile: 'remote-agent' },
      ],
      fallbackProfile: 'default',
      profileModelGroups: [],
      globalModelGroups: globalGroups,
      selectedProvider: 'custom:nas',
      selectedModel: 'nas-default',
    })

    expect(options.map(option => option.value)).toEqual(['remote-one-work', 'gateway:remote-two'])
  })

  it('prefers profile-specific groups but keeps global NAS choices available', () => {
    const profileModelGroups: ProfileAvailableModels[] = [{
      profile: 'minion59',
      default: 'minion-default',
      default_provider: 'custom:minion59',
      groups: [{ provider: 'custom:minion59', label: '小赫59', base_url: '', api_key: '', models: ['minion-default'] }],
    }]

    const groups = getModelGroupsForGatewayTarget({
      profile: 'minion59',
      profileModelGroups,
      globalModelGroups: globalGroups,
      selectedProvider: 'custom:nas',
      selectedModel: 'nas-default',
    })

    expect(groups[0]).toMatchObject({ provider: 'custom:minion59', models: ['minion-default'] })
    expect(groups.find(group => group.provider === 'custom:nas')?.models).toContain('nas-default')
    expect(resolveModelSelectionForGatewayTarget({
      profile: 'minion59',
      profileModelGroups,
      globalModelGroups: globalGroups,
      selectedProvider: 'custom:nas',
      selectedModel: 'nas-default',
    })).toEqual({ provider: 'custom:minion59', model: 'minion-default' })
  })
})
