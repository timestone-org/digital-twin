<script setup lang="ts">
/**
 * @fileoverview 右区的对话面板：标题栏（当前对话与回合状态）、时间线、输入区。
 * 与助手面板同一形态，时间线与输入框的壳都是共用件。
 *
 * ⚠ `--ai-edge` 在这里的根上再声明一遍：助手把它声明在 `.ai-panel` 上，
 * 这一页不套那层壳，标题栏与输入区的两条发光线引的都是这一份。
 */
import { DtButton, DtCard, DtTag } from '@dt/ui'

import AiCoreIcon from '@/components/ai/AiCoreIcon.vue'
import AiTimeline from '@/components/ai/AiTimeline.vue'
import type { KnowledgeConversation } from '@/composables/useKnowledgeConversation'
import KnowledgeChatComposer from './KnowledgeChatComposer.vue'

defineProps<{
  /** 这一页的那段对话，由页面持有；面板只把它接到时间线与输入区上。 */
  chat: KnowledgeConversation
  /** 当前对话的显示名；没选中时 null，标题栏写「新对话」。 */
  title: string | null
  /** 空态里可点的几句开场。 */
  starters: readonly string[]
  /** 这套部署接了语音识别：输入区多一枚麦克风键。 */
  speechEnabled: boolean
}>()

defineEmits<{
  send: [text: string]
}>()
</script>

<template>
  <DtCard
    padding="none"
    class="chat-panel flex min-h-0 flex-1 flex-col overflow-hidden"
  >
    <div class="chat-panel__bar">
      <AiCoreIcon :size="22" />
      <span class="chat-panel__name">知识库对话</span>
      <span class="chat-panel__where">{{ title ?? '新对话' }}</span>
      <!-- 反问期间回合也还跑着，先认「等你选择」：那才是此刻要用户做的事 -->
      <DtTag v-if="chat.isAsking.value" intent="warning" size="sm">
        等你选择
      </DtTag>
      <DtTag v-else-if="chat.isRunning.value" intent="info" size="sm">
        回答中
      </DtTag>
      <DtButton
        variant="ghost"
        size="xs"
        icon="trash"
        aria-label="清空这一屏的对话"
        title="清空对话"
        :disabled="chat.entries.value.length === 0"
        @click="chat.clear"
      />
    </div>

    <AiTimeline
      :entries="chat.entries.value"
      :starters="starters"
      empty-title="问一句资料里的事"
      @starter="$emit('send', $event)"
      @answer="chat.answerAsk"
    />

    <KnowledgeChatComposer
      :running="chat.isRunning.value"
      :asking="chat.isAsking.value"
      :speech-enabled="speechEnabled"
      @send="$emit('send', $event)"
      @stop="chat.stop"
    />
  </DtCard>
</template>

<style scoped lang="scss">
.chat-panel {
  /* 两条发光分隔线共用的一笔。⚠ 用强调色的 rgb 伴生变量拼出来，
     换主题时跟着全局强调色走，不携带任何一种固定色相 */
  --ai-edge: linear-gradient(
    90deg,
    transparent,
    rgba(var(--accent-primary-rgb), 0.55),
    rgba(var(--accent-secondary-rgb), 0.35),
    transparent
  );
}

.chat-panel__bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  /* 标题栏压一层更实的底，滚动内容从它下面过时不会糊在一起 */
  background: var(--surface-raised);
}

/* 底边那条发光细线。⚠ 用伪元素而不是 border-bottom：border 只能是实色，
   而这条要中间亮两头淡，才不至于把面板横切成两段。 */
.chat-panel__bar::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1px;
  background: var(--ai-edge);
}

.chat-panel__name {
  color: var(--text-title);
  font-family: var(--font-display);
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
  text-shadow: 0 0 12px var(--fx-glow-title);
}

.chat-panel__where {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 0.75rem;
}
</style>
