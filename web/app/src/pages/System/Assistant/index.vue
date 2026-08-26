<script setup lang="ts">
/**
 * @fileoverview 助手模型：这套部署接了哪几路，订阅账号那一路登没登录。
 *
 * ⚠ 这一页管的凭据是**整套部署共用的一份**：换掉它等于替所有人换了说话的账号，
 * 所以它要 `assistant:manage` 而不是 `assistant:use`。
 *
 * ⚠ 页面上不出现任何令牌。后端也不回——账号只以掩码露面。
 */
import { computed, onMounted, ref } from 'vue'
import type { AssistantModelProfile } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtNotice, DtTag, useConfirm } from '@dt/ui'

import { probeCapability } from '@/api/assistant'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { formatDateTime } from '@/utils/datetime'
import SystemTabs from '../components/SystemTabs.vue'
import DeviceCodeCard from './components/DeviceCodeCard.vue'
import { CODEX_PROVIDER, useCodexLogin } from './scripts/useCodexLogin'

const confirm = useConfirm()
const login = useCodexLogin()

const profiles = ref<AssistantModelProfile[]>([])
const defaultId = ref('')

const codex = computed(() =>
  profiles.value.find((one) => one.id === CODEX_PROVIDER),
)

async function loadCapability(): Promise<void> {
  const capability = await probeCapability()
  profiles.value = capability?.models ?? []
  defaultId.value = capability?.default_model_id ?? ''
}

async function signOut(): Promise<void> {
  const ok = await confirm.ask({
    title: '退出模型账号',
    message:
      '这一份凭据是整套部署共用的：退出之后，所有人的助手都会立刻停在' +
      '「这一路还没登录」。会话历史不受影响。',
    confirmText: '退出登录',
    danger: true,
  })
  if (!ok) return
  await login.signOut()
  await loadCapability()
}

async function onLoggedIn(): Promise<void> {
  await loadCapability()
}

onMounted(async () => {
  await Promise.all([loadCapability(), login.refresh()])
})
</script>

<template>
  <AppShell title="助手模型" subtitle="这套部署接了哪几路模型">
    <template #tabs><SystemTabs /></template>

    <PermGuard :codes="[PERMISSION_CODES.assistantManage]" explain>
      <section class="model-page h-full min-h-0">
        <DtNotice v-if="login.error.value" intent="danger">
          {{ login.error.value }}
        </DtNotice>

        <ul v-if="profiles.length > 0" class="model-list">
          <li v-for="one in profiles" :key="one.id" class="model-row">
            <span class="model-row__name">{{ one.label }}</span>
            <DtTag v-if="one.id === defaultId" size="sm">默认</DtTag>
            <DtTag :intent="one.is_ready ? 'success' : 'warning'" size="sm">
              {{ one.is_ready ? '可用' : '未登录' }}
            </DtTag>
            <span class="model-row__models">{{ one.models.join('、') }}</span>
          </li>
        </ul>
        <DtNotice v-else intent="warning">
          这套部署一路模型都没接，助手只能读历史会话。
        </DtNotice>

        <section v-if="codex" class="model-codex">
          <h2 class="model-codex__title">订阅账号</h2>
          <p class="model-codex__hint">
            用手上那份订阅跑助手，而不是按 token 计费。⚠
            这条路走的是未公开接口，是否允许这么用取决于你的账号与订阅条款。
          </p>

          <dl v-if="login.status.value?.is_connected" class="model-facts">
            <dt>账号</dt>
            <dd>{{ login.status.value.account_label ?? '—' }}</dd>
            <dt>订阅档</dt>
            <dd>{{ login.status.value.plan_label ?? '—' }}</dd>
            <dt>令牌到期</dt>
            <dd>{{ formatDateTime(login.status.value.expires_at) }}</dd>
            <dt>最近续期</dt>
            <dd>{{ formatDateTime(login.status.value.last_refresh_at) }}</dd>
          </dl>

          <DtNotice v-if="login.status.value?.last_error" intent="warning">
            上次续期没成：{{
              login.status.value.last_error
            }}。重新登录一次即可。
          </DtNotice>

          <DeviceCodeCard
            v-if="login.pending.value"
            :pending="login.pending.value"
            @cancel="login.cancel"
            @done="onLoggedIn"
          />

          <div class="model-codex__actions">
            <DtButton
              size="sm"
              :disabled="login.isBusy.value || login.pending.value !== null"
              @click="() => void login.begin()"
            >
              {{ login.status.value?.is_connected ? '换一个账号' : '登录账号' }}
            </DtButton>
            <DtButton
              v-if="login.status.value?.is_connected"
              variant="ghost"
              size="sm"
              :disabled="login.isBusy.value"
              @click="() => void signOut()"
            >
              退出登录
            </DtButton>
          </div>
        </section>
      </section>
    </PermGuard>
  </AppShell>
</template>

<style scoped lang="scss">
/* ⚠ AppShell 的 main 是 overflow-hidden：页面不自己吃满高度并留出滚动，
   超出的部分会被裁掉，而页面上任何位置都没有滚动条 */
.model-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  overflow-y: auto;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.model-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

.model-row__name {
  color: var(--text-title);
  font-weight: 600;
}

.model-row__models {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  text-align: right;
}

.model-codex {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-panel);
}

.model-codex__title {
  margin: 0;
  color: var(--text-title);
  font-size: 1rem;
}

.model-codex__hint {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  line-height: 1.6;
}

.model-facts {
  display: grid;
  grid-template-columns: 6rem 1fr;
  gap: 0.25rem 1rem;
  margin: 0;
  font-size: 0.875rem;
}

.model-facts dt {
  color: var(--text-secondary);
}

.model-facts dd {
  margin: 0;
  color: var(--text-primary);
}

.model-codex__actions {
  display: flex;
  gap: 0.5rem;
}
</style>
