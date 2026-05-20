import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  deleteGatewayRegistryEntry,
  deleteSpaceRegistryEntry,
  fetchGatewayRegistry,
  fetchSpaces,
  testGatewayRegistryEntry,
  type GatewayRegistryEntry,
  type SpaceRegistryEntry,
  upsertGatewayRegistryEntry,
  upsertSpaceRegistryEntry,
} from '@/api/hermes/gateway-registry'

export const useGatewayRegistryStore = defineStore('gateway-registry', () => {
  const gateways = ref<GatewayRegistryEntry[]>([])
  const spaces = ref<SpaceRegistryEntry[]>([])
  const loading = ref(false)
  const error = ref('')

  const gatewayLabelByProfile = computed(() => {
    const labels = new Map<string, string>()
    for (const gateway of gateways.value) {
      labels.set(gateway.profile, gateway.displayName || gateway.id)
    }
    return labels
  })

  async function fetchAll() {
    loading.value = true
    error.value = ''
    try {
      const [gatewayData, spaceData] = await Promise.all([
        fetchGatewayRegistry(),
        fetchSpaces(),
      ])
      gateways.value = gatewayData
      spaces.value = spaceData
    } catch (err: any) {
      error.value = err?.message || 'failed to load gateway registry'
      throw err
    } finally {
      loading.value = false
    }
  }

  function labelForProfile(profile?: string | null): string {
    if (!profile) return ''
    return gatewayLabelByProfile.value.get(profile) || profile
  }

  async function upsertGateway(gateway: Partial<GatewayRegistryEntry> & { id: string }) {
    return upsertGatewayRegistryEntry(gateway)
  }

  async function deleteGateway(id: string) {
    return deleteGatewayRegistryEntry(id)
  }

  async function testGateway(id: string) {
    return testGatewayRegistryEntry(id)
  }

  async function upsertSpace(space: Partial<SpaceRegistryEntry> & { id: string }) {
    return upsertSpaceRegistryEntry(space)
  }

  async function deleteSpace(id: string) {
    return deleteSpaceRegistryEntry(id)
  }

  return {
    gateways,
    spaces,
    loading,
    error,
    gatewayLabelByProfile,
    fetchAll,
    labelForProfile,
    upsertGateway,
    deleteGateway,
    testGateway,
    upsertSpace,
    deleteSpace,
  }
})
