<script setup lang="ts">
/**
 * @fileoverview 一条召回的引用卡：序号 + 出处行 + 命中词高亮的正文。
 *
 * ⚠ 出处（文档名 + 位置）必须在：指不出出处的召回，用户没法核对，也就判断
 * 不了这个库配得对不对。
 */
import { computed } from 'vue'
import { DtTag } from '@dt/ui'

import type { KnowledgeHit } from '@/api/knowledge'
import { splitByQuery } from '../scripts/highlight'

const props = defineProps<{
  hit: KnowledgeHit
  /** 从 1 起的序号，与对话里的 [n] 引用同一套。 */
  ordinal: number
  query: string
}>()

const parts = computed(() => splitByQuery(props.hit.text, props.query))
</script>

<template>
  <li
    class="grid grid-cols-[2.5rem_minmax(0,1fr)] rounded-md border border-border-subtle bg-surface-sunken/40 px-3 py-2"
  >
    <span class="font-mono text-xs leading-5 text-accent-on-surface">
      [{{ props.ordinal }}]
    </span>
    <div class="min-w-0">
      <p
        class="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-text-secondary"
      >
        <span class="font-medium text-text-primary">
          {{ props.hit.documentTitle }}
        </span>
        <template v-if="props.hit.where !== ''">
          <span aria-hidden="true">·</span>
          <span>{{ props.hit.where }}</span>
        </template>
        <template v-if="props.hit.headingPath !== ''">
          <span aria-hidden="true">·</span>
          <span class="text-text-disabled">{{ props.hit.headingPath }}</span>
        </template>
        <DtTag
          v-if="props.hit.why !== ''"
          intent="neutral"
          size="sm"
          class="ml-auto"
        >
          {{ props.hit.why }}
        </DtTag>
      </p>
      <p class="mb-0 mt-1 whitespace-pre-wrap text-sm">
        <template v-for="part in parts" :key="part.start">
          <mark
            v-if="part.isHit"
            class="rounded-sm bg-accent-primary/20 px-0.5 text-inherit"
            >{{ part.text }}</mark
          >
          <span v-else>{{ part.text }}</span>
        </template>
      </p>
    </div>
  </li>
</template>
