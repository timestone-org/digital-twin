<script setup lang="ts">
/**
 * @fileoverview 引用里的一条：角标 + 位置，点开是原文与那几张图。
 *
 * ⚠ 单拎成一个件是为了让父件的模板嵌套不超过 6 层（闸门守着）。它同时也让
 * 「一条引用长什么样」有了一个可以单测的落点。
 */
import { ref } from 'vue'
import { DtIcon } from '@dt/ui'
import type { KnowledgeCitation } from '@dt/contracts'

const props = defineProps<{ item: KnowledgeCitation }>()

/** ⚠ 默认收起：依据是给要核对的人看的，摊开会把答案挤到屏幕外。 */
const isOpen = ref(false)

/** 一张图的取回地址。⚠ 走服务端端点而不是对象存储直链：知识库的图不匿名可读。 */
function figureSrc(figureId: string): string {
  return `/api/v1/knowledge/documents/${props.item.document_id}/figures/${figureId}`
}
</script>

<template>
  <li>
    <button
      type="button"
      class="cites__row"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
    >
      <span class="cites__mark">{{ item.marker }}</span>
      <span class="cites__where">{{ item.where }}</span>
      <DtIcon
        :name="isOpen ? 'chevron-down' : 'chevron-right'"
        :size="13"
        class="cites__fold"
      />
    </button>
    <div v-if="isOpen" class="cites__body">
      <p class="cites__text">{{ item.text }}</p>
      <figure v-for="fig in item.figures" :key="fig.id" class="cites__figure">
        <img
          :src="figureSrc(fig.id)"
          :alt="fig.caption || '资料里的一张图'"
          loading="lazy"
        />
        <figcaption v-if="fig.caption">{{ fig.caption }}</figcaption>
      </figure>
    </div>
  </li>
</template>

<style scoped lang="scss">
.cites__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.1875rem 0.25rem;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.75rem;
  text-align: left;
  cursor: pointer;
}

.cites__row:hover {
  background: var(--surface-raised);
}

/* 角标：与正文里那个字符同一个字形，靠颜色认出来它是可点的 */
.cites__mark {
  flex: none;
  color: var(--accent-primary);
  font-size: 0.875rem;
}

.cites__where {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cites__fold {
  flex: none;
  color: var(--text-disabled);
}

.cites__body {
  margin: 0 0 0.375rem 1.5rem;
  padding-left: 0.5rem;
  border-left: 1px solid var(--border-default);
}

.cites__text {
  margin: 0;
  color: var(--text-primary);
  font-size: 0.75rem;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.cites__figure {
  margin: 0.375rem 0 0;
}

.cites__figure img {
  display: block;
  max-width: min(100%, 22rem);
  height: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}

.cites__figure figcaption {
  padding-top: 0.1875rem;
  color: var(--text-disabled);
  font-size: 0.6875rem;
}
</style>
