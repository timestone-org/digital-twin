<script setup lang="ts">
/**
 * @fileoverview 检索试验台：输一句话，看这个库召回什么。
 *
 * ⚠ `note` 必须显示出来：「这套部署没接嵌入档，本次只走了关键词那一路」这句话
 * 不显示的话，用户会把一次退化的召回当成「库里就这些」。
 * ⚠ 每条召回都带出处（文档名 + 位置）：指不出出处的召回，用户没法核对，
 * 也就判断不了这个库配得对不对。
 */
import { DtButton, DtEmpty, DtInput, DtNotice } from '@dt/ui'

import type { KnowledgeSearchResult } from '@/api/knowledge'

const props = defineProps<{
  query: string
  result: KnowledgeSearchResult | null
  isSearching: boolean
}>()

const emit = defineEmits<{
  'update:query': [value: string]
  search: []
}>()
</script>

<template>
  <section class="flex flex-col gap-3">
    <div class="flex gap-2">
      <DtInput
        :model-value="props.query"
        type="search"
        size="sm"
        placeholder="试着问一句，看看这个库召回什么"
        aria-label="检索试验台"
        @update:model-value="emit('update:query', $event)"
        @keyup.enter="emit('search')"
      />
      <DtButton
        size="sm"
        :loading="props.isSearching"
        :disabled="props.query.trim() === ''"
        @click="emit('search')"
      >
        检索
      </DtButton>
    </div>

    <DtNotice
      v-if="props.result !== null && props.result.note !== ''"
      intent="warning"
    >
      {{ props.result.note }}
    </DtNotice>

    <DtEmpty
      v-if="props.result !== null && props.result.hits.length === 0"
      inline
      title="这个库里没查到"
      description="换个说法再试一次，或者确认资料已经传进来并且状态是「已就绪」"
    />

    <ol v-else-if="props.result !== null" class="flex flex-col gap-3">
      <li
        v-for="(hit, index) in props.result.hits"
        :key="hit.chunkId"
        class="rounded border border-border-subtle p-3"
      >
        <p class="text-xs text-text-secondary">
          [{{ index + 1 }}] {{ hit.documentTitle
          }}<span v-if="hit.where !== ''"> · {{ hit.where }}</span>
          <span class="ml-2">{{ hit.why }}</span>
        </p>
        <p class="mt-1 whitespace-pre-wrap text-sm">{{ hit.text }}</p>
      </li>
    </ol>
  </section>
</template>
