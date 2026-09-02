<script setup lang="ts">
/**
 * @fileoverview 选中知识库的详情头：名 / 策略与嵌入档 / 描述 / 刷新与删除 / 元信息行。
 */
import type { KnowledgeStrategy } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtCard, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import type { KnowledgeBase } from '@/api/knowledge'
import { formatDateTime } from '@/utils/datetime'

defineProps<{
  base: KnowledgeBase
  /** 表里此刻的文档数：库清单上那个数不随上传与删除动。 */
  documentCount: number
  refreshing: boolean
}>()

defineEmits<{
  refresh: []
  remove: []
}>()

const STRATEGY_LABELS: Record<KnowledgeStrategy, string> = {
  naive: '关键词',
  hybrid: '混合',
  agentic: '智能体',
}
</script>

<template>
  <DtCard>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2.5">
          <h2 class="m-0 truncate text-lg font-semibold" :title="base.name">
            {{ base.name }}
          </h2>
          <DtTag intent="info" size="sm">
            {{ STRATEGY_LABELS[base.strategy] }}
          </DtTag>
          <DtTag v-if="base.embeddingModel !== null" mono size="sm">
            {{ base.embeddingModel }}
          </DtTag>
          <DtTag v-else intent="warning" size="sm">未建索引</DtTag>
        </div>
        <p
          v-if="base.description !== ''"
          class="mt-1 truncate text-xs text-text-secondary"
          :title="base.description"
        >
          {{ base.description }}
        </p>
      </div>

      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <!-- 刷新状态是纯读，不设门禁 -->
        <DtButton
          variant="ghost"
          size="sm"
          icon="refresh-cw"
          aria-label="刷新状态"
          :loading="refreshing"
          @click="$emit('refresh')"
        />
        <PermGuard :codes="[PERMISSION_CODES.knowledgeManage]">
          <DtButton
            variant="ghost"
            intent="danger"
            size="sm"
            icon="trash"
            aria-label="删除知识库"
            @click="$emit('remove')"
          />
        </PermGuard>
      </div>
    </div>

    <!-- 元信息行 -->
    <div
      class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border-subtle pt-3 text-xs"
    >
      <span class="text-text-secondary">
        文档 <span class="text-text-primary">{{ documentCount }} 份</span>
      </span>
      <span v-if="base.dimensions !== null" class="text-text-secondary">
        向量维数 <span class="text-text-primary">{{ base.dimensions }}</span>
      </span>
      <span class="text-text-secondary">
        建于
        <span class="text-text-primary">{{
          formatDateTime(base.createdAt)
        }}</span>
      </span>
    </div>
  </DtCard>
</template>
