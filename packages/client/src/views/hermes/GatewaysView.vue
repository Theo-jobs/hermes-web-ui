<script setup lang="ts">
import { onMounted } from 'vue'
import { NSpin, NButton, NTag, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useGatewayStore } from '@/stores/hermes/gateways'
import { useGatewayRegistryStore } from '@/stores/hermes/gateway-registry'

const { t } = useI18n()
const message = useMessage()
const gatewayStore = useGatewayStore()
const registryStore = useGatewayRegistryStore()

onMounted(() => {
  gatewayStore.fetchStatus()
  registryStore.fetchAll()
})

function runtimeForProfile(profile: string) {
  return gatewayStore.gateways.find(gw => gw.profile === profile)
}

function gatewayDisplayName(gatewayId: string) {
  const gateway = registryStore.gateways.find(gw => gw.id === gatewayId)
  return gateway?.displayName || gatewayId
}

async function handleToggle(name: string, running: boolean) {
  try {
    if (running) {
      await gatewayStore.stop(name)
      message.success(`${t('gateways.stopped')}: ${name}`)
    } else {
      await gatewayStore.start(name)
      message.success(`${t('gateways.started')}: ${name}`)
    }
  } catch (err: any) {
    message.error(err.message)
  }
}
</script>

<template>
  <div class="gateways-view">
    <header class="page-header">
      <h2 class="header-title">{{ t('gateways.title') }}</h2>
    </header>

    <div class="gateways-content">
      <section class="section-block">
        <div class="section-heading">
          <h3>Gateway Registry</h3>
          <p>会话绑定用的网关注册表；用于区分本机、赫风等不同 Hermes 入口。</p>
        </div>
        <NSpin :show="registryStore.loading" size="small">
          <div v-if="registryStore.gateways.length === 0" class="empty-state">
            {{ t('common.noData') }}
          </div>
          <div v-else class="registry-grid">
            <div v-for="gw in registryStore.gateways" :key="gw.id" class="registry-card">
              <div class="registry-card-main">
                <div class="registry-title-row">
                  <span class="registry-name">{{ gw.displayName || gw.id }}</span>
                  <NTag size="small" round>{{ gw.type }}</NTag>
                  <NTag v-if="gw.readonly" size="small" round type="warning">readonly</NTag>
                </div>
                <div class="gateway-meta wrap">
                  <span class="meta-item">id: {{ gw.id }}</span>
                  <span class="meta-item">profile: {{ gw.profile }}</span>
                  <span v-if="gw.spaceId" class="meta-item">space: {{ gw.spaceId }}</span>
                  <span v-if="gw.defaultModel" class="meta-item">model: {{ gw.defaultModel }}</span>
                </div>
                <div class="gateway-meta wrap">
                  <span v-if="gw.upstream" class="meta-item">upstream: {{ gw.upstream }}</span>
                  <span v-if="gw.apiKeyEnv" class="meta-item">key env: {{ gw.apiKeyEnv }}</span>
                  <span v-if="gw.apiKeyEnv" class="meta-item">{{ gw.hasApiKey ? 'key: present' : 'key: missing' }}</span>
                </div>
              </div>
              <div class="gateway-actions">
                <template v-if="runtimeForProfile(gw.profile)">
                  <NTag :type="runtimeForProfile(gw.profile)?.running ? 'success' : 'default'" size="small" round>
                    {{ runtimeForProfile(gw.profile)?.running ? t('gateways.running') : t('gateways.stopped') }}
                  </NTag>
                  <span v-if="runtimeForProfile(gw.profile)?.pid" class="meta-item">PID: {{ runtimeForProfile(gw.profile)?.pid }}</span>
                </template>
                <NTag v-else size="small" round type="info">registry only</NTag>
              </div>
            </div>
          </div>
        </NSpin>
      </section>

      <section class="section-block">
        <div class="section-heading">
          <h3>Spaces</h3>
          <p>工作空间与默认网关/profile 的映射。</p>
        </div>
        <NSpin :show="registryStore.loading" size="small">
          <div v-if="registryStore.spaces.length === 0" class="empty-state">
            {{ t('common.noData') }}
          </div>
          <div v-else class="space-grid">
            <div v-for="space in registryStore.spaces" :key="space.id" class="space-card">
              <div class="space-name">{{ space.displayName }}</div>
              <div class="gateway-meta wrap">
                <span class="meta-item">id: {{ space.id }}</span>
                <span class="meta-item">gateway: {{ gatewayDisplayName(space.gatewayId) }}</span>
                <span class="meta-item">profile: {{ space.profile }}</span>
              </div>
            </div>
          </div>
        </NSpin>
      </section>

      <section class="section-block">
        <div class="section-heading">
          <h3>Runtime Process</h3>
          <p>当前本机 gateway 进程状态；不是完整的多网关注册表。</p>
        </div>
        <NSpin :show="gatewayStore.loading" size="large">
          <div v-if="gatewayStore.gateways.length === 0" class="empty-state">
            {{ t('common.noData') }}
          </div>

          <div v-else class="gateway-list">
            <div v-for="gw in gatewayStore.gateways" :key="gw.profile" class="gateway-card">
              <div class="gateway-info">
                <div class="gateway-name">{{ gw.profile }}</div>
                <div class="gateway-meta">
                  <span class="meta-item">{{ gw.host }}:{{ gw.port }}</span>
                  <span v-if="gw.pid" class="meta-item">PID: {{ gw.pid }}</span>
                </div>
              </div>
              <div class="gateway-actions">
                <NTag :type="gw.running ? 'success' : 'default'" size="small" round>
                  {{ gw.running ? t('gateways.running') : t('gateways.stopped') }}
                </NTag>
                <NButton
                  size="small"
                  :type="gw.running ? 'warning' : 'primary'"
                  round
                  @click="handleToggle(gw.profile, gw.running)"
                >
                  {{ gw.running ? t('common.stop') : t('common.start') }}
                </NButton>
              </div>
            </div>
          </div>
        </NSpin>
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.gateways-view {
  height: calc(100 * var(--vh));
  display: flex;
  flex-direction: column;
}

.gateways-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.empty-state {
  text-align: center;
  color: $text-muted;
  padding: 40px 0;
}

.section-block {
  margin-bottom: 28px;
}

.section-heading {
  margin-bottom: 12px;

  h3 {
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: 600;
    color: $text-primary;
  }

  p {
    margin: 0;
    font-size: 12px;
    color: $text-muted;
  }
}

.gateway-list,
.registry-grid,
.space-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.gateway-card,
.registry-card,
.space-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background-color: $bg-card;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  transition: border-color $transition-fast;

  &:hover {
    border-color: $text-muted;
  }
}

.gateway-name,
.registry-name,
.space-name {
  font-size: 14px;
  font-weight: 600;
  color: $text-primary;
  margin-bottom: 4px;
}

.registry-card-main {
  min-width: 0;
}

.registry-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.gateway-meta {
  display: flex;
  gap: 12px;
}

.gateway-meta.wrap {
  flex-wrap: wrap;
  gap: 6px 12px;
}

.meta-item {
  font-size: 12px;
  color: $text-muted;
}

.gateway-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
