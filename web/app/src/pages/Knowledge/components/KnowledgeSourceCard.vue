<script setup lang="ts">
/** @fileoverview 来源卡片：可见的配置、同步状态和权限门禁。 */
import { computed } from 'vue'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtNotice } from '@dt/ui'
import type { KnowledgeSource } from '@/api/knowledge'
import PermGuard from '@/components/PermGuard.vue'
import { formatDateTime } from '@/utils/datetime'
import { isCursorPlatformPath } from '../scripts/sourcePath'
const props = defineProps<{
  source: KnowledgeSource
  isBusy: boolean
  isLoading: boolean
}>()
defineEmits<{ sync: [source: KnowledgeSource] }>()
const path = computed(() =>
  typeof props.source.config.path === 'string' ? props.source.config.path : '',
)
</script>
<template>
  <li class="min-w-0 rounded border border-border-default p-3">
    <p class="truncate text-sm text-text-title" :title="source.name">
      {{ source.name }}
    </p>
    <p class="text-xs text-text-secondary">
      {{
        source.kind === 'upload' ? '文件上传 · 传文档时自动摄取' : source.kind
      }}
    </p>
    <p
      v-if="source.kind === 'platform'"
      class="mt-1 break-all text-xs text-text-secondary"
    >
      {{ path }}
    </p>
    <p class="mt-1 text-xs text-text-secondary">
      {{
        source.lastSyncedAt === null
          ? '尚未同步'
          : `上次同步：${formatDateTime(source.lastSyncedAt)}`
      }}
    </p>
    <DtNotice
      v-if="isCursorPlatformPath(source.config.path)"
      class="mt-2"
      intent="warning"
      >此来源使用 after 游标，当前不支持同步。</DtNotice
    >
    <DtNotice
      v-if="source.lastError !== ''"
      class="mt-2 break-all"
      intent="danger"
      >{{ source.lastError }}</DtNotice
    >
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
  </li>
</template>
