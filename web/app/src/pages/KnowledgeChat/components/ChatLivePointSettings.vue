<script setup lang="ts">
/** @fileoverview 实时卡片的小数位与采样信息设置浮层。 */
import { DtButton, DtNumberInput, DtPopover } from '@dt/ui'

defineProps<{ sourceName: string; sampledAt: string; quality: string }>()
const decimals = defineModel<number | undefined>()
</script>

<template>
  <DtPopover align="end" panel-label="数值卡片设置">
    <template #default="{ toggle, isOpen, panelId }">
      <DtButton
        variant="ghost"
        size="xs"
        aria-label="数值卡片设置"
        :aria-expanded="isOpen"
        :aria-controls="panelId"
        @click="toggle"
        >设置</DtButton
      >
    </template>
    <template #content>
      <div class="chat-live-point__settings">
        <DtNumberInput
          v-model="decimals"
          aria-label="小数位"
          label="小数位"
          size="sm"
          :range="{ min: 0, max: 10, step: 1, precision: 0 }"
        />
        <span>{{ sourceName }}</span>
        <span>采样时间：{{ sampledAt }}</span>
        <span>{{ quality || '尚无读数' }}</span>
      </div>
    </template>
  </DtPopover>
</template>

<style scoped lang="scss">
.chat-live-point__settings {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 14rem;
  padding: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}
</style>
