<script setup lang="ts">
/**
 * @fileoverview 模块状态的可见交代：正常态什么都不画；其余几档模块本来就没
 * 东西可显示，整格盖住并说明原因。
 */
import type { ModuleStatus } from '@dt/contracts'
import { DtSpinner } from '@dt/ui'
import { computed } from 'vue'

const props = defineProps<{
  status: ModuleStatus
  /** `error` 档的原因，来自求值结果；空串表示没有原因可说。 */
  message: string
}>()

/** 每一档给用户看的一句话。 */
const LABELS: Record<ModuleStatus, string> = {
  loading: '加载中',
  connected: '',
  empty: '暂无数据',
  unbound: '未绑定数据来源',
  error: '取数失败',
}

const isSilent = computed(() => props.status === 'connected')
const label = computed(() => LABELS[props.status])
</script>

<template>
  <div
    v-if="!isSilent"
    class="dt-module-status dt-module-status--cover"
    role="status"
  >
    <DtSpinner v-if="status === 'loading'" :size="18" />
    <span class="dt-module-status__label">{{ label }}</span>
    <span v-if="message" class="dt-module-status__message">{{ message }}</span>
  </div>
</template>

<style scoped lang="scss">
.dt-module-status {
  position: absolute;
  display: flex;
  align-items: center;
  color: var(--text-secondary);
  font-size: 12px;
  gap: 6px;
  pointer-events: none;
}

// 盖住整格：这几档模块本来就没东西可画，留白等于什么都不说
.dt-module-status--cover {
  inset: 0;
  flex-direction: column;
  justify-content: center;
  padding: 8px;
  background: color-mix(in srgb, var(--surface-panel) 88%, transparent);
  text-align: center;
}

.dt-module-status__message {
  max-width: 92%;
  color: var(--text-secondary);
  font-size: 11px;
  opacity: 0.8;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}
</style>
