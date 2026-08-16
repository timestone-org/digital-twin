<script setup lang="ts">
/**
 * @fileoverview 点位表的批量操作条：勾选后出现，唯一的用途是批量开关记录历史。
 */
import { DtButton } from '@dt/ui'

defineProps<{
  count: number
  busy: boolean
}>()

defineEmits<{
  batch: [next: boolean]
  clear: []
}>()
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-2 rounded-md border border-accent-primary/30 bg-accent-primary/10 px-3 py-2 text-xs"
  >
    <span class="text-text-secondary">已选 {{ count }} 项</span>
    <span class="h-3.5 w-px bg-border-subtle" />
    <DtButton
      variant="ghost"
      size="sm"
      icon="database"
      :loading="busy"
      @click="$emit('batch', true)"
    >
      批量开启记录历史
    </DtButton>
    <DtButton
      variant="ghost"
      size="sm"
      icon="database-zap"
      :loading="busy"
      @click="$emit('batch', false)"
    >
      批量关闭记录历史
    </DtButton>
    <DtButton variant="ghost" size="sm" class="ml-auto" @click="$emit('clear')">
      取消选择
    </DtButton>
  </div>
</template>
