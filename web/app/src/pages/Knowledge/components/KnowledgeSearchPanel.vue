<script setup lang="ts">
/**
 * @fileoverview 检索试验台：输一句话，看这个库召回什么。
 *
 * ⚠ `note` 必须显示出来：「这套部署没接嵌入档，本次只走了关键词那一路」这句话
 * 不显示的话，用户会把一次退化的召回当成「库里就这些」。
 * ⚠ 接没接重排也摆出来（ADR-0042）：没接时召回按融合名次给出，而「质量跟
 * 别处不一样」是查不动的——除非有人先说过这一路在哪一档上。
 */
import {
  DtButton,
  DtCard,
  DtEmpty,
  DtIcon,
  DtInput,
  DtNotice,
  DtTag,
} from '@dt/ui'

import type {
  KnowledgeRerankLane,
  KnowledgeSearchResult,
} from '@/api/knowledge'
import KnowledgeHitCard from './KnowledgeHitCard.vue'

const props = defineProps<{
  query: string
  /** 上一次真正发出去的那句；高亮按它算，不按输入框里正在改的那句。 */
  searched: string
  result: KnowledgeSearchResult | null
  isSearching: boolean
  /** 重排那一路此刻接没接；目录还没拉到时是 null。 */
  rerank: KnowledgeRerankLane | null
}>()

const emit = defineEmits<{
  'update:query': [value: string]
  search: []
}>()
</script>

<template>
  <DtCard
    icon="search"
    title="检索试验台"
    subtitle="输一句话，看这个库召回什么"
    class="flex min-h-0 flex-col"
  >
    <div class="flex min-h-0 flex-1 flex-col gap-3">
      <div class="flex gap-2">
        <DtInput
          class="min-w-0 flex-1"
          :model-value="props.query"
          type="search"
          size="sm"
          placeholder="试着问一句"
          aria-label="检索试验台"
          @update:model-value="emit('update:query', $event)"
          @enter="emit('search')"
        >
          <template #leading>
            <DtIcon name="search" :size="14" />
          </template>
        </DtInput>
        <DtButton
          size="sm"
          :loading="props.isSearching"
          :disabled="props.query.trim() === ''"
          @click="emit('search')"
        >
          检索
        </DtButton>
      </div>

      <p v-if="props.rerank !== null" class="rerank-lane">
        <DtTag size="sm" :intent="props.rerank.isEnabled ? 'info' : 'neutral'">
          {{ props.rerank.isEnabled ? '已接重排' : '未接重排' }}
        </DtTag>
        <span class="min-w-0 flex-1 truncate">
          {{
            props.rerank.isEnabled ? props.rerank.model : props.rerank.reason
          }}
        </span>
      </p>

      <DtNotice
        v-if="props.result !== null && props.result.note !== ''"
        intent="warning"
        icon="alert-triangle"
      >
        {{ props.result.note }}
      </DtNotice>

      <div class="relative min-h-0 flex-1">
        <div class="absolute inset-0 overflow-y-auto">
          <DtEmpty
            v-if="props.result !== null && props.result.hits.length === 0"
            size="inline"
            title="这个库里没查到"
            hint="换个说法再试一次，或者确认资料已经传进来并且状态是「已就绪」"
          />
          <ol
            v-else-if="props.result !== null"
            class="m-0 flex list-none flex-col gap-2 p-0"
          >
            <KnowledgeHitCard
              v-for="(hit, index) in props.result.hits"
              :key="hit.chunkId"
              :hit="hit"
              :ordinal="index + 1"
              :query="props.searched"
            />
          </ol>
        </div>
      </div>
    </div>
  </DtCard>
</template>

<style scoped lang="scss">
.rerank-lane {
  display: flex;
  gap: 0.375rem;
  align-items: center;
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.75rem;
}
</style>
