<script setup lang="ts">
/**
 * @fileoverview 助手面板上那一条时间线：说的话、想的过程、做的每一步，
 * 一律**同一条**，不分两栏。分开的话，用户要在两处之间来回对时间才能看出
 * 「它是先查了点位再绑的」，而那正是这个面板要交代的事。
 *
 * ⚠ 新内容一律滚到底，但**用户自己往上翻之后就不再抢**：抢的话，他想回看
 * 上一步时会被一直拽回底部。
 */
import { nextTick, ref, watch } from 'vue'
import { DtMarkdown } from '@dt/ui'

import AiCoreIcon from '@/components/ai/AiCoreIcon.vue'
import AiReasoning from '@/components/ai/AiReasoning.vue'
import AiStepRow from '@/components/ai/AiStepRow.vue'
import type { ChatEntry } from '@/features/ai/conversationLog'

const props = defineProps<{ entries: readonly ChatEntry[] }>()

const scroller = ref<HTMLElement | null>(null)
/** 离底多少像素以内算「还盯着最新的」。 */
const NEAR_BOTTOM = 48

function isAtBottom(box: HTMLElement): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight < NEAR_BOTTOM
}

watch(
  // ⚠ 盯的是最后一条的字数而不是条数：流式时条数不变、内容一直在长，
  // 只盯条数的话整段回答期间一次都不滚
  () => [props.entries.length, props.entries.at(-1)?.text.length],
  async () => {
    const box = scroller.value
    if (box === null) return
    const wasAtBottom = isAtBottom(box)
    await nextTick()
    if (wasAtBottom) box.scrollTop = box.scrollHeight
  },
)
</script>

<template>
  <div ref="scroller" class="ai-stream">
    <!-- 空态不走 DtEmpty：它的 icon 只收注册名，塞不进这个会动的图标 -->
    <div v-if="entries.length === 0" class="ai-stream__empty">
      <AiCoreIcon :size="72" />
      <p class="ai-stream__empty-title">说说你想做什么</p>
      <p class="ai-stream__empty-hint">
        比如「把 1 号机组的温度绑到这个数值卡上」
      </p>
    </div>
    <ul v-else class="ai-stream__list">
      <template v-for="entry in entries" :key="entry.id">
        <li v-if="entry.role === 'user'" class="ai-said ai-said--mine">
          {{ entry.text }}
        </li>
        <li
          v-else-if="entry.role === 'assistant'"
          class="ai-said"
          :class="{ 'ai-said--live': entry.isStreaming }"
        >
          <DtMarkdown :text="entry.text" />
        </li>
        <AiReasoning
          v-else-if="entry.role === 'reasoning'"
          :text="entry.text"
          :streaming="entry.isStreaming === true"
        />
        <li v-else-if="entry.role === 'note'" class="ai-note">
          {{ entry.text }}
        </li>
        <li v-else-if="entry.role === 'error'" class="ai-said ai-said--bad">
          {{ entry.text }}
        </li>
        <AiStepRow v-else-if="entry.step" :step="entry.step" />
      </template>
    </ul>
  </div>
</template>

<style scoped lang="scss">
.ai-stream {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.75rem;
}

.ai-stream__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2.5rem 1rem;
  text-align: center;
}

.ai-stream__empty-title {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.ai-stream__empty-hint {
  margin: 0;
  color: var(--text-disabled);
  font-size: 0.75rem;
}

.ai-stream__list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-said {
  max-width: 92%;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  color: var(--text-primary);
  font-size: 0.875rem;
  line-height: 1.6;
  word-break: break-word;
}

/* 自己说的那条：右对齐 + 一道左侧强调边。⚠ 不靠背景色区分——
   `--surface-raised` 只有 15% 不透明度，在深色底上与助手那条几乎一个样，
   而「谁说的」是这个面板最要紧的一件事。 */
.ai-said--mine {
  align-self: flex-end;
  border-color: var(--border-strong);
  border-left: 2px solid var(--accent-primary);
  background: var(--surface-raised);
  color: var(--text-title);
  white-space: pre-wrap;
}

/* 还在逐字长的那一条：末尾一个呼吸的小方块，让「它还在说」看得见 */
.ai-said--live::after {
  content: '';
  display: inline-block;
  width: 0.4em;
  height: 1em;
  margin-left: 0.15em;
  vertical-align: text-bottom;
  background: var(--accent-primary);
  animation: ai-caret 1s steps(2, start) infinite;
}

.ai-note {
  padding: 0.125rem 0.5rem;
  color: var(--text-secondary);
  font-size: 0.75rem;
  text-align: center;
}

.ai-said--bad {
  max-width: 100%;
  background: transparent;
  border-color: var(--state-danger);
  color: var(--state-danger);
  white-space: pre-wrap;
}

@keyframes ai-caret {
  to {
    visibility: hidden;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ai-said--live::after {
    animation: none;
  }
}
</style>
