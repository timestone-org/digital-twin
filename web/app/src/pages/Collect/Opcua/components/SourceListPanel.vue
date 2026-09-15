<script setup lang="ts">
/**
 * @fileoverview 左栏的数据源列表卡片：骨架 / 错误 / 空态 / 列表四态。
 * 选择与刷新都冒泡给主从页，本组件不发请求。
 */
import { computed } from 'vue'
import type { CollectSource } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtCard, DtEmpty, DtInput, DtSkeleton, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import SourceListItem from './SourceListItem.vue'

const props = defineProps<{
  keyword?: string
  page?: number
  size?: number
  total?: number
  isFiltered?: boolean
  sources: readonly CollectSource[]
  loading: boolean
  error: string | null
  activeId: string | null
}>()

defineEmits<{
  'update:keyword': [value: string]
  search: []
  page: [value: number]
  select: [id: string]
  reload: []
  create: []
}>()
const hasPages = computed(() => (props.total ?? 0) > (props.size ?? 100))
const previousDisabled = computed(() => props.loading || (props.page ?? 1) <= 1)
const nextDisabled = computed(
  () =>
    props.loading ||
    (props.page ?? 1) * (props.size ?? 100) >= (props.total ?? 0),
)
</script>

<template>
  <DtCard icon="server" title="数据源" class="flex min-h-0 flex-1 flex-col">
    <template #actions>
      <DtTag v-if="sources.length !== 0" size="sm">
        {{ sources.length }}
      </DtTag>
      <DtButton
        variant="ghost"
        size="sm"
        icon="refresh-cw"
        aria-label="刷新数据源列表"
        :loading="loading"
        @click="$emit('reload')"
      />
    </template>

    <div class="mb-3 flex gap-2">
      <DtInput
        :model-value="keyword ?? ''"
        size="sm"
        placeholder="搜索数据源名称或编码"
        @update:model-value="$emit('update:keyword', $event)"
        @enter="$emit('search')"
      />
      <DtButton variant="outline" size="sm" @click="$emit('search')">
        查找
      </DtButton>
    </div>
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
          :title="isFiltered ? '没有匹配的数据源' : '还没有数据源'"
          :hint="
            isFiltered
              ? '请调整搜索关键词。'
              : '新增一个 OPC UA 数据源，连接后即可浏览并导入点位。'
          "
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
    <div
      v-if="hasPages"
      class="mt-3 flex items-center justify-between gap-2 text-xs"
    >
      <DtButton
        variant="ghost"
        size="sm"
        :disabled="previousDisabled"
        @click="$emit('page', (page ?? 1) - 1)"
      >
        上一页
      </DtButton>
      <span> 第 {{ page }} 页 · 共 {{ total }} 个 </span>
      <DtButton
        variant="ghost"
        size="sm"
        :disabled="nextDisabled"
        @click="$emit('page', (page ?? 1) + 1)"
      >
        下一页
      </DtButton>
    </div>
  </DtCard>
</template>
