<script setup lang="ts">
/**
 * @fileoverview 一轮答案的「依据」：一份文档一行，只列**用到的页**。
 *
 * ⚠ 这一块取代的是「把检索到的十来条全摆出来」。那种摆法等于让用户自己从
 * 一堆里找哪几条支撑了那句话——依据看着很多，其实没用。
 *
 * ⚠ 角标（`①②③`）与答案正文里那个字符逐字一致：用户扫到正文里的 ③，
 * 在这里找同一个 ③。所以这里绝不重新编号。
 */
import { computed } from 'vue'
import { DtIcon, DtTag } from '@dt/ui'
import type { KnowledgeCitation } from '@dt/contracts'

import AiCitationRow from '@/components/ai/AiCitationRow.vue'
import {
  groupedCitations,
  pagesLabel,
} from '@/features/knowledgeChat/citationGroups'

const props = defineProps<{
  /** 这一轮真正用到的那几条。⚠ 空数组不会走到这里——上层根本不建这一条。 */
  items: readonly KnowledgeCitation[]
}>()

const groups = computed(() => groupedCitations(props.items))
</script>

<template>
  <section class="cites" aria-label="这一轮答案的依据">
    <h4 class="cites__head">
      <DtIcon name="link" :size="14" />
      依据
    </h4>
    <div v-for="group in groups" :key="group.documentId" class="cites__doc">
      <p class="cites__title">
        <span class="cites__name">{{ group.documentTitle }}</span>
        <DtTag v-if="group.pages.length > 0" intent="info" size="sm">
          第 {{ pagesLabel(group.pages) }} 页
        </DtTag>
        <span class="cites__base">{{ group.baseName }}</span>
      </p>
      <ul class="cites__list">
        <AiCitationRow
          v-for="one in group.items"
          :key="one.chunk_id"
          :item="one"
        />
      </ul>
    </div>
  </section>
</template>

<style scoped lang="scss">
.cites {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
  padding: 0.625rem 0.75rem;
  border-left: 2px solid var(--accent-primary);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: var(--surface-sunken);
}

.cites__head {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
}

.cites__doc {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.cites__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  margin: 0;
  font-size: 0.8125rem;
}

.cites__name {
  color: var(--text-primary);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.cites__base {
  color: var(--text-disabled);
  font-size: 0.6875rem;
}

.cites__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 角标：与正文里那个字符同一个字形，靠颜色认出来它是可点的 */
</style>
