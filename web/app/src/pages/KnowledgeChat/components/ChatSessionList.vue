<script setup lang="ts">
/**
 * @fileoverview 左栏：对话清单卡片。选择与改名 / 归档 / 删除都冒泡给页面，
 * 本组件不发请求。
 */
import type { KnowledgeChatSession } from '@dt/contracts'
import { DtCard, DtEmpty, DtTag } from '@dt/ui'

import ChatSessionItem from './ChatSessionItem.vue'

defineProps<{
  sessions: readonly KnowledgeChatSession[]
  selectedId: string | null
}>()

defineEmits<{
  select: [sessionId: string]
  rename: [sessionId: string, title: string]
  archive: [sessionId: string]
  remove: [sessionId: string]
}>()
</script>

<template>
  <DtCard icon="sparkles" title="对话" class="flex min-h-0 flex-1 flex-col">
    <template #actions>
      <DtTag v-if="sessions.length !== 0" size="sm">
        {{ sessions.length }}
      </DtTag>
    </template>

    <div class="relative min-h-0 flex-1">
      <div class="absolute inset-0 overflow-y-auto">
        <DtEmpty
          v-if="sessions.length === 0"
          icon="sparkles"
          title="还没有对话"
          hint="直接在右边发第一句，会自动建一个。"
        />
        <ul v-else class="flex flex-col gap-2">
          <ChatSessionItem
            v-for="one in sessions"
            :key="one.id"
            :session="one"
            :active="one.id === selectedId"
            @select="$emit('select', one.id)"
            @rename="$emit('rename', one.id, $event)"
            @archive="$emit('archive', one.id)"
            @remove="$emit('remove', one.id)"
          />
        </ul>
      </div>
    </div>
  </DtCard>
</template>
