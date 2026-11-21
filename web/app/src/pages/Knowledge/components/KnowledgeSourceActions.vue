<script setup lang="ts">
/** @fileoverview 来源同步、编辑和解绑的权限与状态。 */
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton } from '@dt/ui'
import type { KnowledgeSource } from '@/api/knowledge'
import PermGuard from '@/components/PermGuard.vue'
import { isCursorPlatformPath } from '../scripts/sourcePath'
import { supportsSourceManagement } from '../scripts/sourceMetadata'

defineProps<{ source: KnowledgeSource; isBusy: boolean; isLoading: boolean }>()
defineEmits<{
  sync: [source: KnowledgeSource]
  edit: [source: KnowledgeSource]
  detach: [source: KnowledgeSource]
}>()
</script>
<template>
  <PermGuard
    v-if="source.kind === 'platform'"
    :codes="[PERMISSION_CODES.knowledgeWrite]"
  >
    <DtButton
      size="sm"
      class="mt-2"
      :aria-label="`同步${source.name}`"
      :disabled="
        isBusy || isLoading || isCursorPlatformPath(source.config.path)
      "
      @click="$emit('sync', source)"
      >同步</DtButton
    >
  </PermGuard>
  <PermGuard
    v-if="supportsSourceManagement(source)"
    :codes="[PERMISSION_CODES.knowledgeManage]"
  >
    <DtButton
      size="sm"
      variant="ghost"
      :aria-label="`编辑${source.name}`"
      :disabled="isBusy || isLoading"
      @click="$emit('edit', source)"
      >编辑</DtButton
    >
    <DtButton
      size="sm"
      variant="ghost"
      intent="danger"
      :aria-label="`解绑${source.name}`"
      :disabled="isBusy || isLoading"
      @click="$emit('detach', source)"
      >解绑</DtButton
    >
  </PermGuard>
</template>
