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

vi.mock('@/shared/session-display', () => ({
  formatTimestampMs: () => 'now',
}))

vi.mock('naive-ui', () => ({
  NPopconfirm: {
    name: 'NPopconfirm',
    emits: ['positive-click'],
    template: '<span><slot name="trigger" /><slot /></span>',
  },
  NCheckbox: {
    name: 'NCheckbox',
    props: ['checked'],
    emits: ['click'],
    template: '<input type="checkbox" :checked="checked" @click="$emit(\'click\')" />',
  },
  NTooltip: {
    name: 'NTooltip',
    template: '<span><slot name="trigger" /><slot /></span>',
  },
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
      ...overrides,
    },
    global: {
      stubs: {
        ProfileAvatar: true,
      },
    },
  })
}

function seedGatewayStores() {
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
}

describe('SessionListItem', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    seedGatewayStores()
  })

  it('renders normal mode as a link to the session route', () => {
    const wrapper = mountItem('kira', {
      id: 's1',
      title: 'Session One',
      model: 'gpt-test',
      provider: 'openai',
      to: '/session/s1',
      canDelete: true,
    })

    const link = wrapper.get('a.session-item')
    expect(link.attributes('href')).toBe('/session/s1')
    expect(wrapper.find('button.session-item').exists()).toBe(false)
  })

  it('renders selectable mode as a button and does not expose row href', () => {
    const wrapper = mountItem('kira', {
      id: 's1',
      selectable: true,
      selected: false,
      to: '/session/s1',
      canDelete: true,
    })

    expect(wrapper.find('button.session-item').exists()).toBe(true)
    expect(wrapper.find('a.session-item').exists()).toBe(false)
  })

  it('does not select the row when clicking nested action controls', async () => {
    const wrapper = mountItem('kira', {
      id: 's1',
      to: '/session/s1',
      canDelete: true,
    })

    await wrapper.get('button.session-item-delete').trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('does not hijack modified clicks on normal links', async () => {
    const wrapper = mountItem('kira', {
      id: 's1',
      to: '/session/s1',
      canDelete: true,
    })

    const link = wrapper.get('a.session-item')
    link.element.addEventListener('click', event => event.preventDefault())
    await link.trigger('click', { ctrlKey: true })
    expect(wrapper.emitted('select')).toBeUndefined()
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
