// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import SessionListItem from '@/components/hermes/chat/SessionListItem.vue'
import { useAppStore } from '@/stores/hermes/app'
import { useGatewayRegistryStore } from '@/stores/hermes/gateway-registry'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

function baseSession(profile: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `${profile}-session`,
    profile,
    title: `${profile} chat`,
    messages: [],
    createdAt: 1,
    updatedAt: 2,
    model: 'gpt-5.5',
    provider: 'openai-codex',
    messageCount: 2,
    ...overrides,
  }
}

function mountItem(profile: string, overrides: Record<string, unknown> = {}) {
  return mount(SessionListItem, {
    props: {
      session: baseSession(profile, overrides) as any,
      active: false,
      pinned: false,
      canDelete: false,
      showProfile: true,
    },
    global: {
      stubs: {
        NTooltip: { template: '<div><slot name="trigger" /><slot /></div>' },
        NPopconfirm: { template: '<div><slot name="trigger" /><slot /></div>' },
      },
    },
  })
}

describe('SessionListItem gateway model availability', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())

    const appStore = useAppStore()
    appStore.profileModelGroups = [{
      profile: 'default',
      default: 'gpt-5.5',
      default_provider: 'openai-codex',
      groups: [{ provider: 'openai-codex', label: 'Codex', base_url: '', api_key: '', models: ['gpt-5.5'] }],
    }]
    appStore.modelGroups = [{ provider: 'openai-codex', label: 'Codex', base_url: '', api_key: '', models: ['gpt-5.5'] }]
    appStore.selectedProvider = 'openai-codex'
    appStore.selectedModel = 'gpt-5.5'

    const gatewayRegistry = useGatewayRegistryStore()
    gatewayRegistry.gateways = [
      { id: 'hefeng', profile: 'hefeng', type: 'remote', displayName: 'Hefeng remote' },
    ]
    gatewayRegistry.loading = false
    gatewayRegistry.loaded = true
    vi.spyOn(gatewayRegistry, 'fetchAll').mockResolvedValue(undefined)
  })

  it('does not mark registered remote gateway sessions as missing models when global models are available', () => {
    const wrapper = mountItem('hefeng')

    expect(wrapper.classes()).not.toContain('missing-models')
    expect(wrapper.find('.session-item-warning').exists()).toBe(false)
  })

  it('keeps registered remote gateway sessions clean while model catalogs are refreshing', () => {
    const appStore = useAppStore()
    appStore.modelGroups = []
    appStore.selectedProvider = ''
    appStore.selectedModel = ''

    const wrapper = mountItem('hefeng', {
      provider: 'custom:hefeng',
      model: 'gpt-5.5',
    })

    expect(wrapper.classes()).not.toContain('missing-models')
    expect(wrapper.find('.session-item-warning').exists()).toBe(false)
  })

  it('still warns for unknown profiles that have no model source', () => {
    const wrapper = mountItem('deleted-profile')

    expect(wrapper.classes()).toContain('missing-models')
    expect(wrapper.find('.session-item-warning').exists()).toBe(true)
  })

  it('does not flash missing-model warnings before gateway registry has loaded', () => {
    const gatewayRegistry = useGatewayRegistryStore()
    gatewayRegistry.loaded = false
    gatewayRegistry.gateways = []

    const wrapper = mountItem('hefeng')

    expect(wrapper.classes()).not.toContain('missing-models')
    expect(wrapper.find('.session-item-warning').exists()).toBe(false)
  })
})
