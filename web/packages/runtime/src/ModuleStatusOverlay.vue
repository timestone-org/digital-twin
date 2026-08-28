<script setup lang="ts">
/**
 * @fileoverview 模块状态的可见交代：正常态什么都不画；`stale` 让模块照常显示
 * 最后已知值，只压一层去活化 + 右上角一枚角标；其余几档模块本来就没东西可显示，
 * 整格盖住并说明原因（docs/DASHBOARD_DESIGN.md §5.6）。
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
  stale: '数据可能过期',
  empty: '暂无数据',
  unbound: '未绑定数据来源',
  error: '取数失败',
}

const isSilent = computed(() => props.status === 'connected')
// ⚠ 陈旧那一档绝不盖整格：值还在、还得让人看见，盖住等于把「可能过期」
// 升级成「没有数据」，而后者根本不是事实
const isStale = computed(() => props.status === 'stale')
const isCover = computed(() => !isSilent.value && !isStale.value)
const label = computed(() => LABELS[props.status])
</script>

<template>
  <div
    v-if="isCover"
    class="dt-module-status dt-module-status--cover"
    role="status"
  >
    <DtSpinner v-if="status === 'loading'" :size="18" />
    <span class="dt-module-status__label">{{ label }}</span>
    <span v-if="message" class="dt-module-status__message">{{ message }}</span>
  </div>
  <template v-else-if="isStale">
    <i class="dt-module-status__veil" aria-hidden="true" />
    <span class="dt-module-status dt-module-status--badge" role="status">
      {{ label }}
    </span>
  </template>
</template>

<style scoped lang="scss">
// ⚠ 三条缺一不可：绝对定位让它不参与布局，`pointer-events: none` 让整块可点的
// 模块照常收得到点击，两者少一条都会变成「模块被自己的状态标记挡住」
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

// 去活化：压一层薄纱把对比度降下来，值仍然读得出，但一眼看得出它不是活的。
// ⚠ 只用半透明色，不用 `backdrop-filter`：孪生这类模块底下是逐帧重绘的画布，
// 滤镜会让它每一帧多一次回读
.dt-module-status__veil {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--surface-base) 34%, transparent);
  pointer-events: none;
}

// 右上角的小角标。⚠ 不许换成常规流里的一行：模块自己的内容会被顶下去
.dt-module-status--badge {
  top: 4px;
  right: 4px;
  max-width: calc(100% - 8px);
  padding: 1px 7px;
  border: 1px solid color-mix(in srgb, var(--state-warning) 45%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--state-warning) 14%, var(--surface-base));
  color: var(--state-warning);
  font-size: 11px;
  line-height: 1.6;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
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
