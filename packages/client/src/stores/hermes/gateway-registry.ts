import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  fetchGatewayRegistry,
  fetchSpaces,
  type GatewayRegistryEntry,
  type SpaceRegistryEntry,
} from '@/api/hermes/gateway-registry'

export const useGatewayRegistryStore = defineStore('gateway-registry', () => {
  const gateways = ref<GatewayRegistryEntry[]>([])
  const spaces = ref<SpaceRegistryEntry[]>([])
  const loading = ref(false)

  const gatewayLabelByProfile = computed(() => {
    const labels = new Map<string, string>()
    for (const gateway of gateways.value) {
      labels.set(gateway.profile, gateway.displayName || gateway.id)
    }
    return labels
  })

  async function fetchAll() {
    loading.value = true
    try {
      const [gatewayData, spaceData] = await Promise.all([
        fetchGatewayRegistry(),
        fetchSpaces(),
      ])
      gateways.value = gatewayData
      spaces.value = spaceData
    } finally {
      loading.value = false
    }
  }

  function labelForProfile(profile?: string | null): string {
    if (!profile) return ''
    return gatewayLabelByProfile.value.get(profile) || profile
  }

  return { gateways, spaces, loading, gatewayLabelByProfile, fetchAll, labelForProfile }
})

