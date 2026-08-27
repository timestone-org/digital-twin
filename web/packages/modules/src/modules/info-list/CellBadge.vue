<script setup lang="ts">
/**
 * @fileoverview 行里的徽章位：设备状态档整枚交给共用的 `StatusBadge`，其余两档自绘。
 * ⚠ 严重度词与命中文案是两个不同的词，合成一档会让严重度整个消失、并让行首徽章
 * 与第二行的命中文案变成同一句话重复两遍（MODULE_INFO_CARD_DESIGN §2.3）。
 * ⚠ `variant` 三档对设备状态档不作用：那一档的五档配色与呼吸由 `StatusBadge` 自己带。
 */
import StatusBadge from '../../shared/StatusBadge.vue'
import type { ListBadgeStyle } from './options'
import type { BadgeView } from './rowAlarm'

defineProps<{ badge: BadgeView; variant: ListBadgeStyle }>()
</script>

<template>
  <StatusBadge v-if="badge.status !== null" :status="badge.status" />
  <span
    v-else
    class="il-badge"
    :class="`il-badge--${variant}`"
    :style="badge.vars"
  >
    <i v-if="variant === 'dot'" class="il-badge__dot" aria-hidden="true" />
    <span class="il-badge__text">{{ badge.text }}</span>
  </span>
</template>

<style scoped lang="scss">
.il-badge {
  display: inline-flex;
  flex: none;
  align-items: center;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--il-badge-color, var(--il-row-color, var(--accent-secondary)));
  line-height: 1;
  white-space: nowrap;
  gap: 4px;
}

// 描边档：参考仓 `metric-status-table` 自绘的那套无圆点无动画徽章
.il-badge--outline {
  padding: 3px 8px;
  border-color: currentColor;
  background: color-mix(in srgb, currentColor 16%, transparent);
  font-size: 11px;
  letter-spacing: 0.04em;
}

// 实心档：底是状态色，前景走反色 token —— 亮/暗主题下都读得出来
.il-badge--solid {
  padding: 4px 8px;
  background: currentColor;
  box-shadow: 0 0 8px color-mix(in srgb, currentColor 45%, transparent);
  font-size: 11px;
  letter-spacing: 0.04em;
}

.il-badge--solid .il-badge__text {
  color: var(--text-inverse);
}

// 圆点档：色 + 词双编码。只靠一个圆点的色相，色觉障碍者分不清、读屏拿不到
.il-badge--dot {
  padding: 0;
  border-color: transparent;
  background: none;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.il-badge__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 6px currentColor;
}

.il-badge__text {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
