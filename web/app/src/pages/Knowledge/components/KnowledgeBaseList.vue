<script setup lang="ts">
/**
 * @fileoverview 左栏的知识库列表卡片：骨架 / 空 / 列表三态。
 * 选择、刷新与新建都冒泡给主从页，本组件不发请求。
 */
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtCard, DtEmpty, DtSkeleton, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import type { KnowledgeBase } from '@/api/knowledge'
import KnowledgeBaseItem from './KnowledgeBaseItem.vue'

defineProps<{
  bases: readonly KnowledgeBase[]
  selectedId: string
  loading: boolean
}>()

defineEmits<{
  select: [baseId: string]
  reload: []
  create: []
}>()
</script>

<template>
  <DtCard
    icon="folder-open"
    title="知识库"
    class="flex min-h-0 flex-1 flex-col"
  >
    <template #actions>
      <DtTag v-if="bases.length !== 0" size="sm">{{ bases.length }}</DtTag>
      <DtButton
        variant="ghost"
        size="sm"
        icon="refresh-cw"
        aria-label="刷新知识库列表"
        :loading="loading"
        @click="$emit('reload')"
      />
    </template>

    <div class="relative min-h-0 flex-1">
      <div class="absolute inset-0 overflow-y-auto">
        <!-- 骨架 -->
        <div v-if="loading && bases.length === 0" class="flex flex-col gap-2">
          <DtSkeleton v-for="row in 4" :key="row" class="h-14 w-full" />
        </div>
        <!-- 空 -->
        <DtEmpty
          v-else-if="bases.length === 0"
          icon="folder-open"
          title="还没有知识库"
          hint="新建一个，再往里传手册与规程。"
        >
          <PermGuard :codes="[PERMISSION_CODES.knowledgeManage]">
            <DtButton size="sm" icon="plus" @click="$emit('create')">
              新建知识库
            </DtButton>
          </PermGuard>
        </DtEmpty>
        <!-- 列表 -->
        <div v-else class="flex flex-col gap-2">
          <KnowledgeBaseItem
            v-for="one in bases"
            :key="one.id"
            :base="one"
            :active="one.id === selectedId"
            @select="$emit('select', one.id)"
          />
        </div>
      </div>
    </div>
  </DtCard>
</template>
