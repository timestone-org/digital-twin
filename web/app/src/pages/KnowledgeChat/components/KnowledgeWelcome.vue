<script setup lang="ts">
/** @fileoverview 知识库对话的吉祥物欢迎与快捷提问入口。 */
import { DtButton, DtIcon } from '@dt/ui'
import KnowledgeMascot from '@/features/knowledge/components/KnowledgeMascot.vue'

defineProps<{ starters: readonly string[] }>()
defineEmits<{ starter: [text: string] }>()
</script>

<template>
  <section class="knowledge-welcome" aria-label="知识探索">
    <KnowledgeMascot />
    <p class="knowledge-welcome__eyebrow">让知识触手可及</p>
    <h2>带上好奇心，一起找答案</h2>
    <p class="knowledge-welcome__hint">
      查资料，也能查看实时数据。把问题交给我，从这里开始探索。
    </p>
    <div class="knowledge-welcome__starters">
      <DtButton
        v-for="one in starters"
        :key="one"
        variant="ghost"
        class="knowledge-welcome__starter"
        @click="$emit('starter', one)"
      >
        <template #leading><DtIcon name="search" :size="16" /></template>
        <span>{{ one }}</span>
        <template #trailing><DtIcon name="arrow-right" :size="14" /></template>
      </DtButton>
    </div>
    <p class="knowledge-welcome__footnote">
      支持连续追问 · 可选择知识库范围 · 回答中的引用可供核对
    </p>
  </section>
</template>

<style scoped lang="scss">
.knowledge-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: clamp(0.75rem, 3vh, 2.5rem) 0.5rem 1.5rem;
  text-align: center;
  h2 {
    margin: 0.5rem 0 0;
    color: var(--text-title);
    font-size: clamp(1.25rem, 2vw, 1.8rem);
    font-weight: 650;
    letter-spacing: 0.035em;
  }
  &__eyebrow {
    margin: 0;
    color: var(--accent-primary);
    font-size: 0.75rem;
    letter-spacing: 0.2em;
  }
  &__hint {
    margin: 0.75rem 0 1.5rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
    line-height: 1.8;
  }
  &__starters {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
    width: min(100%, 39rem);
  }
  &__starter {
    height: auto;
    min-height: 3.5rem;
    padding: 0.875rem 1rem;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    background: var(--surface-panel);
    text-align: left;
    white-space: normal;
  }
  &__starter :deep(.dt-btn__label) {
    white-space: normal;
    text-align: left;
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  &__footnote {
    margin: 1.25rem 0 0;
    color: var(--text-secondary);
    font-size: 0.6875rem;
    line-height: 1.7;
  }
}
@media (max-width: 640px) {
  .knowledge-welcome__starters {
    grid-template-columns: 1fr;
  }
  .knowledge-welcome :deep(.knowledge-mascot) {
    width: 10rem;
  }
}
</style>
