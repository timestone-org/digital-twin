<script setup lang="ts">
/**
 * @fileoverview 一枚密钥此刻的状态。
 * ⚠ 「已吊销」与「已过期」要分开说：前者是有人主动收回的，后者是到点自己失效的，
 * 处置方式不同——过期的重发一枚就行，被吊销的得先弄清当初为什么收回。
 */
import { computed } from 'vue'
import type { ApiKey } from '@dt/contracts'
import { DtTag } from '@dt/ui'

const props = defineProps<{ apiKey: ApiKey }>()

const state = computed(() => {
  if (props.apiKey.revoked_at !== null) {
    return { intent: 'danger' as const, label: '已吊销' }
  }
  // is_active 由后端按「此刻」算；这里只在它为假且没被吊销时推断出「过期」
  if (!props.apiKey.is_active) {
    return { intent: 'neutral' as const, label: '已过期' }
  }
  return { intent: 'success' as const, label: '生效中' }
})
</script>

<template>
  <DtTag :intent="state.intent">{{ state.label }}</DtTag>
</template>
