<script setup lang="ts">
/**
 * @fileoverview 规则的状态标签组（启停 + 内置），表格与卡片共用。
 * `emphasis` 只放大主状态那一枚：一张卡最多一枚 md 标签。
 */
import type { RouteRule } from '@dt/contracts'
import { DtTag } from '@dt/ui'

withDefaults(defineProps<{ rule: RouteRule; emphasis?: boolean }>(), {
  emphasis: false,
})
</script>

<template>
  <span class="flex shrink-0 items-center gap-1.5">
    <DtTag
      :intent="rule.is_enabled ? 'success' : 'danger'"
      :size="emphasis ? 'md' : 'sm'"
    >
      {{ rule.is_enabled ? '已启用' : '已停用' }}
    </DtTag>
    <DtTag
      v-if="rule.is_builtin"
      intent="primary"
      title="种子维护，改动会被下次同步覆盖"
    >
      内置
    </DtTag>
  </span>
</template>
