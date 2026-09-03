<script setup lang="ts">
/**
 * @fileoverview 要先登录的那几路各摆一份登录面板。
 *
 * ⚠ 一路一份状态：面板自己按 `providerRef`（那一路供应商的 id）建那一段轮询与
 * 登录态，共用一份的话第二路点登录时改的是第一路。
 */
import type { SubscriptionAccount } from '../scripts/subscriptions'
import CodexAccountPanel from './CodexAccountPanel.vue'

defineProps<{ accounts: readonly SubscriptionAccount[] }>()

const emit = defineEmits<{ changed: [] }>()
</script>

<template>
  <div class="flex flex-col gap-5">
    <section v-for="account in accounts" :key="account.ref" class="account">
      <h4 class="m-0 text-sm text-text-title">{{ account.name }}</h4>
      <CodexAccountPanel
        :provider-ref="account.ref"
        @changed="emit('changed')"
      />
    </section>
  </div>
</template>

<style scoped lang="scss">
.account {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  /* 多路并排时靠一条分隔线断开，免得两份账号信息看成一份 */
  & + & {
    padding-top: 1.25rem;
    border-top: 1px solid var(--border-subtle);
  }
}
</style>
