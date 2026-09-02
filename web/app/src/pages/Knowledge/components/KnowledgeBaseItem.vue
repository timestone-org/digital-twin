<script setup lang="ts">
/**
 * @fileoverview 左栏里的一个知识库条目：名 + 一行 meta，选中时左侧亮一道竖条。
 *
 * ⚠ 嵌入档为 `null` 是「这个库还没建索引」，要单独标出来：不标的话，用户会对着
 * 一个永远搜不到东西的库反复上传。
 */
import { DtIcon, DtTag } from '@dt/ui'

import type { KnowledgeBase } from '@/api/knowledge'

defineProps<{
  base: KnowledgeBase
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
    :aria-current="active ? 'true' : undefined"
    @click="$emit('select')"
  >
    <span
      v-if="active"
      class="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r bg-accent-primary"
    />
    <div class="flex items-center gap-2">
      <DtIcon
        name="folder"
        :size="15"
        :class="active ? 'text-accent-primary' : 'text-text-secondary'"
      />
      <span
        class="min-w-0 flex-1 truncate text-sm font-medium"
        :class="active ? 'text-text-title' : 'text-text-primary'"
        :title="base.name"
      >
        {{ base.name }}
      </span>
    </div>
    <div class="flex items-center gap-2 text-xs text-text-secondary">
      <span class="shrink-0">{{ base.documentCount }} 份文档</span>
      <span aria-hidden="true">·</span>
      <span
        v-if="base.embeddingModel !== null"
        class="min-w-0 truncate font-mono text-2xs text-text-disabled"
        :title="base.embeddingModel"
      >
        {{ base.embeddingModel }}
      </span>
      <DtTag v-else intent="warning" size="sm">未建索引</DtTag>
    </div>
  </button>
</template>
