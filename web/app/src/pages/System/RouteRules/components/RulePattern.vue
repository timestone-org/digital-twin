<script setup lang="ts">
/**
 * @fileoverview 规则的路径模式，表格与卡片共用。字号由调用方给。
 * ⚠ 停用态只降这一处字色（不叠 opacity——取值色已踩在对比度下限上）。
 */
import { computed } from 'vue'
import type { RouteRule } from '@dt/contracts'

const props = defineProps<{
  rule: RouteRule
  /** 折行铺满而不是省略：卡片上路径就是规则的身份，省略成同一个前缀就分不出谁是谁。 */
  wrap?: boolean
}>()

const tone = computed(() =>
  props.rule.is_enabled ? 'text-text-title' : 'text-text-disabled',
)
</script>

<template>
  <code
    class="min-w-0 font-mono"
    :class="[tone, wrap ? 'break-all' : 'truncate']"
    :title="rule.path_pattern"
    >{{ rule.path_pattern }}</code
  >
</template>
