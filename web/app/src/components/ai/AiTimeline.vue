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
import type { AssistantAskAnswer } from '@dt/contracts'
import { DtMarkdown } from '@dt/ui'

import AiAskCard from '@/components/ai/AiAskCard.vue'
import AiCitations from '@/components/ai/AiCitations.vue'
import AiCoreIcon from '@/components/ai/AiCoreIcon.vue'
import AiReasoning from '@/components/ai/AiReasoning.vue'
import AiToolCard from '@/components/ai/AiToolCard.vue'
import type { ChatEntry } from '@/features/ai/conversationLog'
import { withoutToolCallBlocks } from '@/features/ai/toolCallText'

const props = defineProps<{
  entries: readonly ChatEntry[]
  /** 空态里可点的几句开场；点了填进草稿，不直接发。 */
  starters?: readonly string[] | undefined
  /** 空态那一句标题；缺省是助手的口吻。知识库对话换成问句。 */
  emptyTitle?: string | undefined
}>()

const emit = defineEmits<{
  starter: [text: string]
  /** 用户在某一条提问上点了。 */
  answer: [id: string, answer: AssistantAskAnswer]
}>()

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
      <p class="ai-stream__empty-title">{{ emptyTitle ?? '说说你想做什么' }}</p>
      <p
        v-if="starters === undefined || starters.length === 0"
        class="ai-stream__empty-hint"
      >
        比如「把 1 号机组的温度绑到这个数值卡上」
      </p>
      <ul v-else class="ai-stream__starters">
        <li v-for="one in starters" :key="one">
          <button
            type="button"
            class="ai-stream__starter"
            @click="emit('starter', one)"
          >
            {{ one }}
          </button>
        </li>
      </ul>
    </div>
    <ul v-else class="ai-stream__list">
      <template v-for="entry in entries" :key="entry.id">
        <li v-if="entry.role === 'user'" class="ai-said ai-said--mine">
          {{ entry.text }}
        </li>
        <!-- ⚠ 摘完是空的就整条不画：一个空气泡看着像出了什么事，
             而它其实只是模型把一次调用写成了正文 -->
        <li
          v-else-if="
            entry.role === 'assistant' && withoutToolCallBlocks(entry.text)
          "
          class="ai-said"
          :class="{ 'ai-said--live': entry.isStreaming }"
        >
          <DtMarkdown :text="withoutToolCallBlocks(entry.text)" />
        </li>
        <AiReasoning
          v-else-if="entry.role === 'reasoning'"
          :text="withoutToolCallBlocks(entry.text)"
          :streaming="entry.isStreaming === true"
        />
        <li
          v-else-if="entry.role === 'citations' && entry.citations"
          class="ai-cited"
        >
          <AiCitations :items="entry.citations" />
        </li>
        <li v-else-if="entry.role === 'note'" class="ai-note">
          {{ entry.text }}
        </li>
        <li v-else-if="entry.role === 'error'" class="ai-said ai-said--bad">
          {{ entry.text }}
        </li>
        <AiAskCard
          v-else-if="entry.ask"
          :ask="entry.ask"
          @answer="(value) => emit('answer', entry.id, value)"
        />
        <AiToolCard v-else-if="entry.step" :step="entry.step" />
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
  padding: 2rem 1rem;
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

.ai-stream__starters {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin: 0.25rem 0 0;
  padding: 0;
  list-style: none;
}

/* 可点的开场：低调的胶囊，点了只是填进草稿——所以不能长得像「执行」按钮 */
.ai-stream__starter {
  padding: 0.3125rem 0.75rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-pill);
  background: var(--surface-panel);
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.75rem;
  line-height: 1.5;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease;
}

.ai-stream__starter:hover {
  border-color: var(--border-hover);
  color: var(--text-primary);
}

.ai-stream__starter:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 1px;
}

/* 一条竖直轨道，助手做的每一件事都挂在它上面。⚠ 轨道靠伪元素画在列表背后，
   不是给每一项加左边框：加边框的话，两项之间的 gap 会把这条线切成一段一段。 */
.ai-stream__list {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin: 0;
  padding: 0 0 0 0.875rem;
  list-style: none;
}

.ai-stream__list::before {
  content: '';
  position: absolute;
  top: 0.375rem;
  bottom: 0.375rem;
  left: 0.1875rem;
  width: 1px;
  background: linear-gradient(
    180deg,
    rgba(var(--accent-primary-rgb), 0.45),
    rgba(var(--accent-primary-rgb), 0.06)
  );
}

.ai-said {
  position: relative;
  max-width: 92%;
  padding: 0.375rem 0.5rem;
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.875rem;
  line-height: 1.6;
  word-break: break-word;
}

/* 助手说的话不装在框里：一段回答常有好几屏，套上框之后读起来像一张张卡片，
   而它本来就是连续的一段话。轨道上一个小圆点标出它从哪开始。 */
.ai-said::before {
  content: '';
  position: absolute;
  top: 0.75rem;
  left: -0.8125rem;
  width: 0.3125rem;
  height: 0.3125rem;
  border-radius: 50%;
  background: var(--accent-primary);
  box-shadow: 0 0 8px var(--fx-glow-title);
}

/* 自己说的那条：右对齐 + 强调色实心，字用强调底专用前景（各主题都校过对比）。
   ⚠ 「谁说的」是这个面板最要紧的一件事，所以两侧不共享任何一种底色——
   助手那边是透明的，这边是实的。 */
.ai-said--mine {
  align-self: flex-end;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-md);
  border-bottom-right-radius: var(--radius-sm);
  background: var(--accent-primary);
  color: var(--text-on-emphasis);
  box-shadow: 0 6px 18px -8px rgba(var(--accent-primary-rgb), 0.7);
  white-space: pre-wrap;
}

.ai-said--mine::before {
  display: none;
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
  border: 1px solid var(--state-danger);
  background: rgba(var(--state-danger-rgb), 0.08);
  color: var(--state-danger);
  white-space: pre-wrap;
}

.ai-said--bad::before {
  background: var(--state-danger);
  box-shadow: none;
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

  .ai-stream__starter {
    transition: none;
  }
}
</style>
