<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  NAlert,
  NButton,
  NEmpty,
  NInput,
  NModal,
  NPopconfirm,
  NSelect,
  NSpin,
  NTag,
  useMessage,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useGatewayRegistryStore } from '@/stores/hermes/gateway-registry'
import type { GatewayRegistryEntry, GatewayRegistryType, SpaceRegistryEntry } from '@/api/hermes/gateway-registry'
import SettingRow from '@/components/hermes/settings/SettingRow.vue'

const { t } = useI18n()
const message = useMessage()
const gatewayRegistry = useGatewayRegistryStore()

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const ENV_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const PROVIDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/

type GatewayForm = {
  id: string
  displayName: string
  profile: string
  type: GatewayRegistryType
  provider: string
  upstream: string
  defaultModel: string
  spaceId: string
  apiKeyEnv: string
  readonly: boolean
}

type SpaceForm = {
  id: string
  displayName: string
  gatewayId: string
  profile: string
}

const gatewayForm = reactive<GatewayForm>(emptyGatewayForm())
const spaceForm = reactive<SpaceForm>(emptySpaceForm())
const showGatewayModal = ref(false)
const showSpaceModal = ref(false)
const editingGatewayId = ref<string | null>(null)
const editingSpaceId = ref<string | null>(null)
const savingGateway = ref(false)
const savingSpace = ref(false)
const testingGatewayId = ref<string | null>(null)
const gatewaySearch = ref('')

const gatewayById = computed(() =>
  new Map(gatewayRegistry.gateways.map(gateway => [gateway.id, gateway])),
)

const spacesByGateway = computed(() => {
  const groups = new Map<string, typeof gatewayRegistry.spaces>()
  for (const space of gatewayRegistry.spaces) {
    const items = groups.get(space.gatewayId) || []
    items.push(space)
    groups.set(space.gatewayId, items)
  }
  return groups
})

const orphanSpaces = computed(() =>
  gatewayRegistry.spaces.filter(space => !gatewayById.value.has(space.gatewayId)),
)

const localGatewayCount = computed(() =>
  gatewayRegistry.gateways.filter(gateway => gateway.type === 'local').length,
)

const remoteGatewayCount = computed(() =>
  gatewayRegistry.gateways.filter(gateway => gateway.type === 'remote' || gateway.type === 'custom').length,
)

function gatewayTypeText(type?: GatewayRegistryType) {
  if (type === 'local') return t('gateways.typeLocal')
  if (type === 'remote') return t('gateways.typeRemote')
  return t('gateways.typeCustom')
}

function gatewayEndpointLabel(gateway: GatewayRegistryEntry) {
  if (gateway.upstream) return t('gateways.endpointConfigured')
  if (gateway.type === 'local') return t('gateways.endpointLocal')
  return t('gateways.endpointNotConfigured')
}

function gatewaySearchText(gateway: GatewayRegistryEntry) {
  const spaces = gatewayRegistry.spaces.filter(space => space.gatewayId === gateway.id)
  return [
    gateway.id,
    gateway.displayName,
    gateway.profile,
    gateway.type,
    gateway.provider,
    gateway.defaultModel,
    gateway.spaceId,
    ...spaces.flatMap(space => [space.id, space.displayName, space.profile]),
  ].filter(Boolean).join(' ').toLowerCase()
}

const filteredGateways = computed(() => {
  const query = gatewaySearch.value.trim().toLowerCase()
  if (!query) return gatewayRegistry.gateways
  return gatewayRegistry.gateways.filter(gateway => gatewaySearchText(gateway).includes(query))
})

const filteredOrphanSpaces = computed(() => {
  const query = gatewaySearch.value.trim().toLowerCase()
  if (!query) return orphanSpaces.value
  return orphanSpaces.value.filter(space =>
    [space.id, space.displayName, space.gatewayId, space.profile]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query),
  )
})

const isFilteredEmpty = computed(() =>
  !!gatewaySearch.value.trim() && filteredGateways.value.length === 0 && filteredOrphanSpaces.value.length === 0,
)

const gatewayTypeOptions = computed(() => [
  { label: t('gateways.typeLocal'), value: 'local' },
  { label: t('gateways.typeRemote'), value: 'remote' },
  { label: t('gateways.typeCustom'), value: 'custom' },
])

const gatewayOptions = computed(() =>
  gatewayRegistry.gateways.map(gateway => ({
    label: `${gateway.displayName || gateway.id} (${gateway.id})`,
    value: gateway.id,
  })),
)

function emptyGatewayForm(): GatewayForm {
  return {
    id: '',
    displayName: '',
    profile: '',
    type: 'custom',
    provider: '',
    upstream: '',
    defaultModel: '',
    spaceId: '',
    apiKeyEnv: '',
    readonly: false,
  }
}

function emptySpaceForm(): SpaceForm {
  return {
    id: '',
    displayName: '',
    gatewayId: '',
    profile: '',
  }
}

function assignGatewayForm(value: GatewayForm) {
  Object.assign(gatewayForm, value)
}

function assignSpaceForm(value: SpaceForm) {
  Object.assign(spaceForm, value)
}

function openAddGateway() {
  editingGatewayId.value = null
  assignGatewayForm(emptyGatewayForm())
  showGatewayModal.value = true
}

function openEditGateway(gateway: GatewayRegistryEntry) {
  editingGatewayId.value = gateway.id
  assignGatewayForm({
    id: gateway.id,
    displayName: gateway.displayName || '',
    profile: gateway.profile || gateway.id,
    type: gateway.type || 'custom',
    provider: gateway.provider || '',
    upstream: gateway.upstream || '',
    defaultModel: gateway.defaultModel || '',
    spaceId: gateway.spaceId || '',
    apiKeyEnv: gateway.apiKeyEnv || '',
    readonly: !!gateway.readonly,
  })
  showGatewayModal.value = true
}

function openAddSpace(gatewayId = '') {
  editingSpaceId.value = null
  assignSpaceForm({ ...emptySpaceForm(), gatewayId })
  showSpaceModal.value = true
}

function openEditSpace(space: SpaceRegistryEntry) {
  editingSpaceId.value = space.id
  assignSpaceForm({
    id: space.id,
    displayName: space.displayName || '',
    gatewayId: space.gatewayId,
    profile: space.profile,
  })
  showSpaceModal.value = true
}

function validateName(value: string, field: string) {
  if (!NAME_PATTERN.test(value.trim())) throw new Error(t('gateways.invalidName', { field }))
}

function validateGatewayForm() {
  validateName(gatewayForm.id, t('gateways.id'))
  validateName(gatewayForm.profile, t('gateways.profile'))
  if (gatewayForm.spaceId.trim()) validateName(gatewayForm.spaceId, t('gateways.spaceId'))
  if (gatewayForm.apiKeyEnv.trim() && !ENV_PATTERN.test(gatewayForm.apiKeyEnv.trim())) {
    throw new Error(t('gateways.invalidEnv'))
  }
  if (gatewayForm.provider.trim() && !PROVIDER_PATTERN.test(gatewayForm.provider.trim())) {
    throw new Error(t('gateways.invalidProvider'))
  }
  if (gatewayForm.upstream.trim()) {
    const url = new URL(gatewayForm.upstream.trim())
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(t('gateways.invalidUpstream'))
  }
}

function validateSpaceForm() {
  validateName(spaceForm.id, t('gateways.spaceId'))
  validateName(spaceForm.gatewayId, t('gateways.gatewayId'))
  validateName(spaceForm.profile, t('gateways.profile'))
}

async function saveGateway() {
  try {
    validateGatewayForm()
  } catch (err: any) {
    message.error(err?.message || t('gateways.saveFailed'))
    return false
  }

  savingGateway.value = true
  try {
    await gatewayRegistry.upsertGateway({
      id: gatewayForm.id.trim(),
      displayName: gatewayForm.displayName.trim() || gatewayForm.id.trim(),
      profile: gatewayForm.profile.trim(),
      type: gatewayForm.type,
      provider: gatewayForm.provider.trim() || undefined,
      upstream: gatewayForm.upstream.trim() || undefined,
      defaultModel: gatewayForm.defaultModel.trim() || undefined,
      spaceId: gatewayForm.spaceId.trim() || undefined,
      apiKeyEnv: gatewayForm.apiKeyEnv.trim() || undefined,
      readonly: gatewayForm.readonly,
    })
    await gatewayRegistry.fetchAll()
    message.success(t('gateways.saveSuccess'))
    showGatewayModal.value = false
  } catch (err: any) {
    message.error(err?.message || t('gateways.saveFailed'))
  } finally {
    savingGateway.value = false
  }
  return false
}

async function saveSpace() {
  try {
    validateSpaceForm()
  } catch (err: any) {
    message.error(err?.message || t('gateways.saveFailed'))
    return false
  }

  savingSpace.value = true
  try {
    await gatewayRegistry.upsertSpace({
      id: spaceForm.id.trim(),
      displayName: spaceForm.displayName.trim() || spaceForm.id.trim(),
      gatewayId: spaceForm.gatewayId.trim(),
      profile: spaceForm.profile.trim(),
    })
    await gatewayRegistry.fetchAll()
    message.success(t('gateways.saveSuccess'))
    showSpaceModal.value = false
  } catch (err: any) {
    message.error(err?.message || t('gateways.saveFailed'))
  } finally {
    savingSpace.value = false
  }
  return false
}

async function deleteGateway(gateway: GatewayRegistryEntry) {
  if (gateway.readonly) return false
  try {
    await gatewayRegistry.deleteGateway(gateway.id)
    await gatewayRegistry.fetchAll()
    message.success(t('gateways.deleteSuccess'))
  } catch (err: any) {
    message.error(err?.message || t('gateways.deleteFailed'))
  }
  return false
}

async function deleteSpace(space: SpaceRegistryEntry) {
  const gateway = gatewayById.value.get(space.gatewayId)
  if (gateway?.readonly) return false
  try {
    await gatewayRegistry.deleteSpace(space.id)
    await gatewayRegistry.fetchAll()
    message.success(t('gateways.deleteSuccess'))
  } catch (err: any) {
    message.error(err?.message || t('gateways.deleteFailed'))
  }
  return false
}

async function testGateway(gateway: GatewayRegistryEntry) {
  testingGatewayId.value = gateway.id
  try {
    const result = await gatewayRegistry.testGateway(gateway.id)
    if (result.ok) message.success(t('gateways.testSuccess', { status: result.status }))
    else message.error(t('gateways.testFailed', { error: result.error || result.status }))
  } catch (err: any) {
    message.error(t('gateways.testFailed', { error: err?.message || 'unknown' }))
  } finally {
    testingGatewayId.value = null
  }
}

function isSpaceProtected(space: SpaceRegistryEntry) {
  return !!gatewayById.value.get(space.gatewayId)?.readonly
}

onMounted(() => {
  void gatewayRegistry.fetchAll()
})
</script>

<template>
  <div class="gateways-view">
    <header class="page-header">
      <div>
        <h2 class="header-title">{{ t('gateways.title') }}</h2>
        <p class="header-subtitle">{{ t('gateways.subtitle') }}</p>
      </div>
      <div class="header-actions">
        <NButton size="small" secondary @click="openAddSpace()">{{ t('gateways.addSpace') }}</NButton>
        <NButton size="small" type="primary" @click="openAddGateway">{{ t('gateways.addGateway') }}</NButton>
        <NButton size="small" :loading="gatewayRegistry.loading" @click="gatewayRegistry.fetchAll">
          {{ t('gateways.refresh') }}
        </NButton>
      </div>
    </header>

    <div class="gateways-content">
      <NAlert v-if="gatewayRegistry.error" type="error" class="state-alert">
        {{ t('gateways.loadFailed', { error: gatewayRegistry.error }) }}
      </NAlert>
      <NAlert type="info" class="state-alert">
        {{ t('gateways.secretHint') }}
      </NAlert>

      <section class="gateway-directory-toolbar">
        <div class="gateway-directory-copy">
          <div class="gateway-directory-title">{{ t('gateways.directoryTitle') }}</div>
          <div class="gateway-directory-subtitle">
            {{ t('gateways.directorySubtitle', { count: gatewayRegistry.gateways.length }) }}
          </div>
        </div>
        <div class="gateway-directory-stats">
          <NTag size="small">{{ t('gateways.totalCount', { count: gatewayRegistry.gateways.length }) }}</NTag>
          <NTag size="small" type="success">{{ t('gateways.localCount', { count: localGatewayCount }) }}</NTag>
          <NTag size="small" type="info">{{ t('gateways.remoteCount', { count: remoteGatewayCount }) }}</NTag>
        </div>
        <NInput
          v-model:value="gatewaySearch"
          clearable
          class="gateway-search"
          :placeholder="t('gateways.searchPlaceholder')"
        />
      </section>

      <NSpin :show="gatewayRegistry.loading && gatewayRegistry.gateways.length === 0 && gatewayRegistry.spaces.length === 0">
        <NEmpty
          v-if="!gatewayRegistry.loading && gatewayRegistry.gateways.length === 0 && gatewayRegistry.spaces.length === 0"
          :description="t('gateways.empty')"
        />

        <NEmpty
          v-else-if="isFilteredEmpty"
          :description="t('gateways.searchEmpty')"
        />

        <div v-else class="gateway-list">
          <section v-for="gateway in filteredGateways" :key="gateway.id" class="gateway-card">
            <div class="gateway-main">
              <div>
                <div class="gateway-title-line">
                  <div class="gateway-title">{{ gateway.displayName || gateway.id }}</div>
                  <NTag size="small" :type="gateway.type === 'local' ? 'success' : gateway.type === 'remote' ? 'info' : 'default'">
                    {{ gatewayTypeText(gateway.type) }}
                  </NTag>
                </div>
                <div class="gateway-meta">
                  <span>{{ t('gateways.id') }}: {{ gateway.id }}</span>
                  <span>{{ t('gateways.profile') }}: {{ gateway.profile }}</span>
                  <span>{{ t('gateways.endpoint') }}: {{ gatewayEndpointLabel(gateway) }}</span>
                  <span v-if="gateway.provider">{{ t('gateways.provider') }}: {{ gateway.provider }}</span>
                  <span v-if="gateway.defaultModel">{{ t('gateways.defaultModel') }}: {{ gateway.defaultModel }}</span>
                  <span v-if="gateway.spaceId">{{ t('gateways.spaceId') }}: {{ gateway.spaceId }}</span>
                </div>
              </div>
              <div class="gateway-tags">
                <NTag size="small" :type="gateway.hasApiKey ? 'success' : 'default'">
                  {{ gateway.hasApiKey ? t('gateways.apiKeyConfigured') : t('gateways.apiKeyNotConfigured') }}
                </NTag>
                <NTag v-if="gateway.readonly" size="small" type="info">{{ t('gateways.readonly') }}</NTag>
              </div>
            </div>

            <div class="gateway-card-actions">
              <NButton size="tiny" @click="openEditGateway(gateway)">{{ t('gateways.editGateway') }}</NButton>
              <NButton size="tiny" @click="openAddSpace(gateway.id)">{{ t('gateways.addSpace') }}</NButton>
              <NButton size="tiny" :loading="testingGatewayId === gateway.id" @click="testGateway(gateway)">
                {{ t('gateways.testConnection') }}
              </NButton>
              <NPopconfirm :disabled="gateway.readonly" @positive-click="deleteGateway(gateway)">
                <template #trigger>
                  <NButton size="tiny" type="error" :disabled="gateway.readonly">{{ t('gateways.deleteGateway') }}</NButton>
                </template>
                {{ t('gateways.confirmDeleteGateway', { id: gateway.id }) }}
              </NPopconfirm>
            </div>

            <div v-if="spacesByGateway.get(gateway.id)?.length" class="space-list">
              <div v-for="space in spacesByGateway.get(gateway.id)" :key="space.id" class="space-row">
                <div class="space-copy">
                  <span class="space-name">{{ space.displayName }}</span>
                  <span class="space-meta">{{ t('gateways.spaceId') }}: {{ space.id }}</span>
                  <span class="space-meta">{{ t('gateways.spaceProfile') }}: {{ space.profile }}</span>
                  <span class="space-meta">{{ t('gateways.gatewayId') }}: {{ space.gatewayId }}</span>
                </div>
                <div class="space-actions">
                  <NButton size="tiny" :disabled="isSpaceProtected(space)" @click="openEditSpace(space)">{{ t('gateways.editSpace') }}</NButton>
                  <NPopconfirm :disabled="isSpaceProtected(space)" @positive-click="deleteSpace(space)">
                    <template #trigger>
                      <NButton size="tiny" type="error" :disabled="isSpaceProtected(space)">{{ t('gateways.deleteSpace') }}</NButton>
                    </template>
                    {{ t('gateways.confirmDeleteSpace', { id: space.id }) }}
                  </NPopconfirm>
                </div>
              </div>
            </div>
            <div v-else class="empty-spaces">{{ t('gateways.noSpaces') }}</div>
          </section>

          <section v-if="filteredOrphanSpaces.length" class="gateway-card">
            <div class="gateway-title">{{ t('gateways.orphanSpaces') }}</div>
            <div class="space-list">
              <div v-for="space in filteredOrphanSpaces" :key="space.id" class="space-row">
                <div class="space-copy">
                  <span class="space-name">{{ space.displayName }}</span>
                  <span class="space-meta">{{ t('gateways.spaceId') }}: {{ space.id }}</span>
                  <span class="space-meta">{{ t('gateways.spaceProfile') }}: {{ space.profile }}</span>
                  <span class="space-meta">{{ t('gateways.gatewayId') }}: {{ space.gatewayId }}</span>
                </div>
                <div class="space-actions">
                  <NButton size="tiny" @click="openEditSpace(space)">{{ t('gateways.editSpace') }}</NButton>
                  <NPopconfirm @positive-click="deleteSpace(space)">
                    <template #trigger>
                      <NButton size="tiny" type="error">{{ t('gateways.deleteSpace') }}</NButton>
                    </template>
                    {{ t('gateways.confirmDeleteSpace', { id: space.id }) }}
                  </NPopconfirm>
                </div>
              </div>
            </div>
          </section>
        </div>
      </NSpin>
    </div>

    <NModal
      v-model:show="showGatewayModal"
      preset="dialog"
      :title="editingGatewayId ? t('gateways.editGateway') : t('gateways.addGateway')"
      :positive-text="t('common.save')"
      :negative-text="t('common.cancel')"
      :positive-button-props="{ loading: savingGateway }"
      style="width: min(620px, calc(100vw - 32px))"
      @positive-click="saveGateway"
    >
      <div class="settings-editor">
        <section class="settings-editor-section">
          <div class="settings-editor-heading">
            <h3>{{ t('gateways.identitySection') }}</h3>
            <p>{{ t('gateways.identitySectionHint') }}</p>
          </div>
          <SettingRow :label="t('gateways.id')" :hint="t('gateways.idHint')">
            <NInput v-model:value="gatewayForm.id" :disabled="!!editingGatewayId" placeholder="daily-mac" />
          </SettingRow>
          <SettingRow :label="t('gateways.displayName')" :hint="t('gateways.displayNameHint')">
            <NInput v-model:value="gatewayForm.displayName" placeholder="Daily Mac" />
          </SettingRow>
          <SettingRow :label="t('gateways.profile')" :hint="t('gateways.profileHint')">
            <NInput v-model:value="gatewayForm.profile" placeholder="default" />
          </SettingRow>
          <SettingRow :label="t('gateways.type')" :hint="t('gateways.typeHint')">
            <NSelect v-model:value="gatewayForm.type" :options="gatewayTypeOptions" />
          </SettingRow>
          <SettingRow :label="t('gateways.provider')" :hint="t('gateways.providerHint')">
            <NInput v-model:value="gatewayForm.provider" placeholder="custom:nas" />
          </SettingRow>
        </section>

        <section class="settings-editor-section">
          <div class="settings-editor-heading">
            <h3>{{ t('gateways.connectionSection') }}</h3>
            <p>{{ t('gateways.connectionSectionHint') }}</p>
          </div>
          <SettingRow :label="t('gateways.upstream')" :hint="t('gateways.upstreamHint')">
            <NInput v-model:value="gatewayForm.upstream" placeholder="https://example.test" />
          </SettingRow>
          <SettingRow :label="t('gateways.defaultModel')" :hint="t('gateways.defaultModelHint')">
            <NInput v-model:value="gatewayForm.defaultModel" placeholder="gpt-5.5" />
          </SettingRow>
          <SettingRow :label="t('gateways.apiKeyEnv')" :hint="t('gateways.apiKeyEnvHint')">
            <NInput v-model:value="gatewayForm.apiKeyEnv" placeholder="REMOTE_AGENT_API_SERVER_KEY" />
          </SettingRow>
        </section>

        <section class="settings-editor-section">
          <div class="settings-editor-heading">
            <h3>{{ t('gateways.bindingSection') }}</h3>
            <p>{{ t('gateways.bindingSectionHint') }}</p>
          </div>
          <SettingRow :label="t('gateways.spaceId')" :hint="t('gateways.spaceIdHint')">
            <NInput v-model:value="gatewayForm.spaceId" placeholder="daily-mac" />
          </SettingRow>
          <SettingRow :label="t('gateways.readonly')" :hint="t('gateways.readonlyHint')">
            <NTag size="small" :type="gatewayForm.readonly ? 'info' : 'default'">
              {{ gatewayForm.readonly ? t('common.yes') : t('common.no') }}
            </NTag>
          </SettingRow>
        </section>
      </div>
    </NModal>

    <NModal
      v-model:show="showSpaceModal"
      preset="dialog"
      :title="editingSpaceId ? t('gateways.editSpace') : t('gateways.addSpace')"
      :positive-text="t('common.save')"
      :negative-text="t('common.cancel')"
      :positive-button-props="{ loading: savingSpace }"
      style="width: min(520px, calc(100vw - 32px))"
      @positive-click="saveSpace"
    >
      <div class="settings-editor">
        <section class="settings-editor-section">
          <div class="settings-editor-heading">
            <h3>{{ t('gateways.spaceSection') }}</h3>
            <p>{{ t('gateways.spaceSectionHint') }}</p>
          </div>
          <SettingRow :label="t('gateways.spaceId')" :hint="t('gateways.spaceIdHint')">
            <NInput v-model:value="spaceForm.id" :disabled="!!editingSpaceId" placeholder="hefeng-work" />
          </SettingRow>
          <SettingRow :label="t('gateways.displayName')" :hint="t('gateways.displayNameHint')">
            <NInput v-model:value="spaceForm.displayName" placeholder="Hefeng" />
          </SettingRow>
          <SettingRow :label="t('gateways.gatewayId')" :hint="t('gateways.gatewayIdHint')">
            <NSelect v-model:value="spaceForm.gatewayId" :options="gatewayOptions" filterable tag placeholder="local-default" />
          </SettingRow>
          <SettingRow :label="t('gateways.profile')" :hint="t('gateways.spaceProfileHint')">
            <NInput v-model:value="spaceForm.profile" placeholder="default" />
          </SettingRow>
        </section>
      </div>
    </NModal>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.gateways-view {
  height: calc(100 * var(--vh));
  display: flex;
  flex-direction: column;
}

.header-subtitle {
  margin: 4px 0 0;
  color: $text-secondary;
  font-size: 13px;
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.gateways-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.state-alert {
  margin-bottom: 16px;
}

.gateway-directory-toolbar {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto minmax(220px, 320px);
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px 14px;
  border: 1px solid $border-light;
  border-radius: $radius-lg;
  background: $bg-card;
}

.gateway-directory-title {
  color: $text-primary;
  font-size: 14px;
  font-weight: 700;
}

.gateway-directory-subtitle {
  margin-top: 3px;
  color: $text-muted;
  font-size: 12px;
}

.gateway-directory-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.gateway-search {
  width: 100%;
}

.gateway-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.gateway-card {
  padding: 16px;
  border: 1px solid $border-color;
  border-radius: $radius-lg;
  background: $bg-card;
}

.gateway-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.gateway-title {
  font-size: 16px;
  font-weight: 600;
  color: $text-primary;
}

.gateway-title-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.gateway-meta,
.space-meta,
.empty-spaces {
  color: $text-secondary;
  font-size: 12px;
}

.gateway-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-top: 6px;
}

.gateway-tags,
.gateway-card-actions,
.space-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.gateway-card-actions {
  justify-content: flex-start;
  margin-top: 14px;
}

.space-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}

.space-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 14px;
  padding: 10px 12px;
  border-radius: $radius-md;
  background: $bg-secondary;
}

.space-copy {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  min-width: 0;
}

.space-name {
  color: $text-primary;
  font-weight: 500;
}

.empty-spaces {
  margin-top: 14px;
}

.settings-editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.settings-editor-section {
  overflow: hidden;
  border: 1px solid $border-light;
  border-radius: $radius-lg;
  background: $bg-card;

  :deep(.setting-row) {
    padding: 12px 14px;
  }

  :deep(.setting-control) {
    width: min(320px, 44vw);
  }

  :deep(.n-input),
  :deep(.n-base-selection) {
    width: 100%;
  }
}

.settings-editor-heading {
  padding: 13px 14px 11px;
  border-bottom: 1px solid $border-light;
  background: rgba($bg-secondary, 0.62);

  h3 {
    margin: 0;
    color: $text-primary;
    font-size: 13px;
    font-weight: 700;
  }

  p {
    margin: 3px 0 0;
    color: $text-muted;
    font-size: 12px;
    line-height: 1.35;
  }
}

@media (max-width: $breakpoint-mobile) {
  .gateway-main,
  .page-header,
  .gateway-directory-toolbar {
    display: flex;
    align-items: stretch;
    flex-direction: column;
  }

  .header-actions,
  .gateway-tags,
  .space-actions,
  .gateway-directory-stats {
    justify-content: flex-start;
  }

  .settings-editor-section :deep(.setting-control) {
    width: 100%;
  }
}
</style>
