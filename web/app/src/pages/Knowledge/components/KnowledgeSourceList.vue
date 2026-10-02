<script setup lang="ts">
/** @fileoverview 平台与上传来源列表；刷新和同步由外层编排。 */
import { DtButton, DtEmpty } from '@dt/ui'
import type { KnowledgeSource } from '@/api/knowledge'
import KnowledgeSourceCard from './KnowledgeSourceCard.vue'
defineProps<{
  baseName: string
  sources: readonly KnowledgeSource[]
  isBusy: boolean
  isLoading: boolean
}>()
defineEmits<{ reload: []; sync: [source: KnowledgeSource] }>()
</script>
<template>
  <section class="min-w-0">
    <div class="mb-3 flex items-center justify-between gap-3">
      <h3 class="min-w-0 flex-1 break-all text-sm font-medium text-text-title">
        {{ baseName }} 的来源
      </h3>
      <DtButton
        class="shrink-0"
        size="sm"
        variant="ghost"
        :disabled="isBusy"
        :loading="isLoading"
        @click="$emit('reload')"
        >刷新</DtButton
      >
    </div>
    <DtEmpty v-if="!isLoading && sources.length === 0" title="还没有来源" />
    <ul class="flex max-h-120 min-w-0 flex-col gap-3 overflow-y-auto">
      <KnowledgeSourceCard
        v-for="source in sources"
        :key="source.id"
        :source="source"
        :is-busy="isBusy"
        :is-loading="isLoading"
        @sync="$emit('sync', $event)"
      />
    </ul>
  </section>
</template>
