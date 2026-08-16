<script setup lang="ts">
/**
 * @fileoverview 左栏的数据源列表卡片：骨架 / 错误 / 空态 / 列表四态。
 * 选择与刷新都冒泡给主从页，本组件不发请求。
 */
import type { CollectSource } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtCard, DtEmpty, DtSkeleton, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import SourceListItem from './SourceListItem.vue'

defineProps<{
  sources: readonly CollectSource[]
  loading: boolean
  error: string | null
  activeId: string | null
}>()

defineEmits<{
  select: [id: string]
  reload: []
  create: []
}>()
</script>

<template>
  <DtCard icon="server" title="数据源" class="flex min-h-0 flex-1 flex-col">
    <template #actions>
      <DtTag v-if="sources.length !== 0" size="sm">{{ sources.length }}</DtTag>
      <DtButton
        variant="ghost"
        size="sm"
        icon="refresh-cw"
        aria-label="刷新数据源列表"
        :loading="loading"
        @click="$emit('reload')"
      />
    </template>

    <div class="relative min-h-0 flex-1">
      <div class="absolute inset-0 overflow-y-auto">
        <!-- 骨架 -->
        <div v-if="loading && sources.length === 0" class="flex flex-col gap-2">
          <DtSkeleton v-for="row in 4" :key="row" class="h-14 w-full" />
        </div>
        <!-- 错误 -->
        <DtEmpty
          v-else-if="error !== null"
          icon="alert-triangle"
          title="加载数据源失败"
          :hint="error"
        >
          <DtButton variant="outline" size="sm" @click="$emit('reload')">
            重试
          </DtButton>
        </DtEmpty>
        <!-- 空 -->
        <DtEmpty
          v-else-if="sources.length === 0"
          icon="server"
          title="还没有数据源"
          hint="新增一个 OPC UA 数据源，连接后即可浏览并导入点位。"
        >
          <PermGuard :codes="[PERMISSION_CODES.collectManage]">
            <DtButton size="sm" icon="plus" @click="$emit('create')">
              新增数据源
            </DtButton>
          </PermGuard>
        </DtEmpty>
        <!-- 列表 -->
        <div v-else class="flex flex-col gap-2">
          <SourceListItem
            v-for="one in sources"
            :key="one.id"
            :source="one"
            :active="one.id === activeId"
            @select="$emit('select', one.id)"
          />
        </div>
      </div>
    </div>
  </DtCard>
</template>
