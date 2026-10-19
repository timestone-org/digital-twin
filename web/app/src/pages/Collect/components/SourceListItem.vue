<script setup lang="ts">
/**
 * @fileoverview 左侧源列表中的单个数据源条目。
 * 展示名称 / 端点 / 运行态徽标；选中高亮（左侧发光条）。
 *
 * ⚠ 「已停用」由 SourceStateTag 单独标出，不与运行态混成一个灯：
 * 停用的源与连不上的源处置完全不同。
 */
import { DtIcon } from '@dt/ui'
import type { CollectSource } from '@dt/contracts'

import SourceStateTag from './SourceStateTag.vue'

defineProps<{
  source: CollectSource
  active?: boolean
}>()

defineEmits<{ select: [] }>()
</script>

<template>
  <button
    type="button"
    class="group relative flex w-full flex-col gap-1.5 rounded-md border px-3 py-2.5 text-left transition-colors"
    :class="
      active
        ? 'border-accent-primary/50 bg-accent-primary/10'
        : 'border-border-subtle bg-surface-sunken/40 hover:border-border-default hover:bg-accent-primary/5'
    "
    @click="$emit('select')"
  >
    <span
      v-if="active"
      class="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r bg-accent-primary"
    />
    <div class="flex items-center gap-2">
      <DtIcon
        name="server"
        :size="15"
        :class="active ? 'text-accent-primary' : 'text-text-secondary'"
      />
      <span
        class="min-w-0 flex-1 truncate text-sm font-medium"
        :class="active ? 'text-text-title' : 'text-text-primary'"
        :title="source.name"
      >
        {{ source.name }}
      </span>
    </div>
    <div class="flex items-center justify-between gap-2">
      <span
        class="min-w-0 flex-1 truncate font-mono text-2xs text-text-disabled"
        :title="source.endpoint"
      >
        {{ source.endpoint }}
      </span>
      <SourceStateTag
        :runtime="source.runtime"
        :is-enabled="source.is_enabled"
      />
    </div>
  </button>
</template>
