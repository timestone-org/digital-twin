<script setup lang="ts">
/**
 * @fileoverview 订阅账号那一路（ADR-0026）：登没登录、设备码登录、退出。
 *
 * ⚠ 这一份凭据是**整套部署共用的**：换掉它等于替所有人换了说话的账号，
 * 所以它要 `assistant:manage`，与目录那边的 `llm:manage` 是两个码。
 * ⚠ 面板上不出现任何令牌。后端也不回——账号只以掩码露面。
 */
import { onMounted } from 'vue'
import { DtButton, DtNotice, useConfirm } from '@dt/ui'

import { formatDateTime } from '@/utils/datetime'
import DeviceCodeCard from './DeviceCodeCard.vue'
import { useCodexLogin } from '../scripts/useCodexLogin'

const emit = defineEmits<{ changed: [] }>()

const confirm = useConfirm()
const login = useCodexLogin()

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
  emit('changed')
}

onMounted(() => void login.refresh())
</script>

<template>
  <section class="flex flex-col gap-3">
    <p class="m-0 text-2xs leading-relaxed text-text-secondary">
      用手上那份订阅跑助手，而不是按 token 计费。⚠
      这条路走的是未公开接口，是否允许这么用取决于你的账号与订阅条款。
    </p>

    <DtNotice v-if="login.error.value" intent="danger">
      {{ login.error.value }}
    </DtNotice>

    <dl v-if="login.status.value?.is_connected" class="codex-facts">
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
      上次续期没成：{{ login.status.value.last_error }}。重新登录一次即可。
    </DtNotice>

    <DeviceCodeCard
      v-if="login.pending.value"
      :pending="login.pending.value"
      @cancel="login.cancel"
      @done="emit('changed')"
    />

    <div class="flex gap-2">
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
</template>

<style scoped lang="scss">
.codex-facts {
  display: grid;
  grid-template-columns: 6rem 1fr;
  gap: 0.25rem 1rem;
  margin: 0;
  font-size: 0.875rem;

  dt {
    color: var(--text-secondary);
  }

  dd {
    margin: 0;
    color: var(--text-primary);
  }
}
</style>
