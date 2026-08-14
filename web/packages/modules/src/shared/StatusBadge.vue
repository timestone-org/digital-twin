<script setup lang="ts">
/**
 * @fileoverview 设备状态徽标：一个圆点加一段文案，列表族模块共用。
 * 配色全走 token 变量，换肤时自动重着色。
 */
import { computed } from 'vue'

import { STATUS_LABEL, type DeviceStatus } from './status'

const props = defineProps<{
  status: DeviceStatus
  /** 覆盖默认文案；⚠ 传空串就是「显示空文案」，不会回落成状态名。 */
  label?: string
}>()

const text = computed(() => props.label ?? STATUS_LABEL[props.status])
</script>

<template>
  <span class="dt-status-badge" :class="`dt-status-badge--${status}`">
    <span class="dt-status-badge__dot" aria-hidden="true" />
    <span class="dt-status-badge__label">{{ text }}</span>
  </span>
</template>

<style scoped lang="scss">
.dt-status-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--text-primary) 6%, transparent);
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.04em;
  white-space: nowrap;
  gap: 4px;
}

.dt-status-badge__dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 5px currentColor;
}

.dt-status-badge--running {
  border-color: color-mix(in srgb, var(--state-success) 40%, transparent);
  color: var(--state-success);
}

.dt-status-badge--standby {
  border-color: color-mix(in srgb, var(--state-idle) 45%, transparent);
  color: var(--state-idle);
}

.dt-status-badge--alarm {
  border-color: color-mix(in srgb, var(--state-danger) 55%, transparent);
  color: var(--state-danger);
  animation: dt-status-badge-alarm 1.1s ease-in-out infinite;
}

.dt-status-badge--offline {
  border-color: color-mix(in srgb, var(--state-offline) 50%, transparent);
  opacity: 0.8;
  color: var(--state-offline);
}

// 无数据：中性虚线，明确是「不知道」而不是「运行」或「离线」
.dt-status-badge--unknown {
  border-style: dashed;
  border-color: color-mix(in srgb, var(--text-secondary) 35%, transparent);
  opacity: 0.85;
  color: var(--text-secondary);

  .dt-status-badge__dot {
    box-shadow: none;
  }
}

@keyframes dt-status-badge-alarm {
  0%,
  100% {
    box-shadow: 0 0 0 rgba(var(--state-danger-rgb), 0);
  }

  50% {
    box-shadow: 0 0 8px rgba(var(--state-danger-rgb), 0.55);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dt-status-badge--alarm {
    animation: none;
  }
}
</style>
