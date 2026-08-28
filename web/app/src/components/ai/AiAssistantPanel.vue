<script setup lang="ts">
/**
 * @fileoverview 助手面板：外框、时间线、输入区。
 *
 * ⚠ 助手改的是**草稿**，保存永远由用户自己按。面板上一直摆着这句话——
 * 漏了它，用户会以为绑完就落库了，然后关掉标签页。
 *
 * ⚠ 面板消费的是全局语义 token，跟着当前主题走——它是这个产品里的一块工作面，
 * 不是一件异色的挂件。时间线怎么摆在 `AiTimeline`，输入区在 `AiComposer`：
 * 这里只负责把它们与一次对话接起来。
 */
import { computed, ref } from 'vue'
import type { AssistantModelProfile } from '@dt/contracts'
import { DtButton } from '@dt/ui'

import AiComposer from '@/components/ai/AiComposer.vue'
import AiCoreIcon from '@/components/ai/AiCoreIcon.vue'
import AiPlanCard from '@/components/ai/AiPlanCard.vue'
import AiTimeline from '@/components/ai/AiTimeline.vue'
import type { AiConversation } from '@/composables/useAiConversation'
import type { ComposeState, ModelChoice } from '@/composables/useAiPanel'

const props = defineProps<{
  /**
   * 这一页的那段对话。⚠ 由 useAiPanel 持有而不是这里造：面板收起就卸载，
   * 对话（时间线与计划）不能跟着没。
   */
  chat: AiConversation
  /** 输入区的草稿与附件。同样由 useAiPanel 持有。 */
  compose: ComposeState
  surfaceLabel: string
  /** 摆在输入框上方的一句提醒，各页面自己给。 */
  hint?: string | undefined
  /** 空态里可点的几句开场，各页面按自己的能力给。 */
  starters?: readonly string[] | undefined
  /** 面板此刻是不是放大着。宽窄由外面的 dock 管，这里只画那个按钮。 */
  isWide?: boolean | undefined
  /** 这套部署接了哪几路模型。只有一路时下拉整个不渲染。 */
  models?: readonly AssistantModelProfile[] | undefined
  /** 这个会话选了哪一路。 */
  choice?: ModelChoice | undefined
}>()

const emit = defineEmits<{
  close: []
  'toggle-wide': []
  pick: [value: ModelChoice]
}>()

/** 草稿为空时 ↑ 召回的那句：时间线上最后一条自己说的话。 */
const lastSaid = computed<string | null>(() => {
  const entries = props.chat.entries.value
  for (let at = entries.length - 1; at >= 0; at -= 1) {
    const one = entries[at]
    if (one !== undefined && one.role === 'user') return one.text
  }
  return null
})

const composer = ref<InstanceType<typeof AiComposer> | null>(null)

/** 空态开场点进草稿而不是直接发出去：用户得先看见将要发送什么。 */
function onStarter(text: string): void {
  props.compose.setDraft(text)
  composer.value?.focusInput()
}

/**
 * Esc：正跑着先停下，闲着就收起。
 * ⚠ stopPropagation：编辑器在 window 上也听 Esc（清画布选中），
 * 焦点在面板里时那一下不该漏出去。
 */
function onEscape(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  event.stopPropagation()
  if (props.chat.isRunning.value) props.chat.stop()
  else emit('close')
}
</script>

<template>
  <aside class="ai-panel" aria-label="AI 助手" @keydown.esc="onEscape">
    <div class="ai-panel__bar">
      <AiCoreIcon :size="22" />
      <span class="ai-panel__name">AI 助手</span>
      <span class="ai-panel__where">{{ surfaceLabel }}</span>
      <DtButton
        variant="ghost"
        size="xs"
        icon="trash"
        aria-label="清空这一屏的对话"
        title="清空对话"
        :disabled="chat.entries.value.length === 0"
        @click="chat.clear"
      />
      <DtButton
        variant="ghost"
        size="xs"
        :icon="isWide ? 'chevron-right' : 'chevron-left'"
        :aria-label="isWide ? '缩小助手面板' : '放大助手面板'"
        :title="isWide ? '缩小面板' : '放大面板'"
        @click="emit('toggle-wide')"
      />
      <DtButton
        variant="ghost"
        size="xs"
        icon="close"
        aria-label="收起助手面板"
        title="收起（Esc）"
        @click="emit('close')"
      />
    </div>

    <AiPlanCard v-if="chat.plan.value !== null" :plan="chat.plan.value" />

    <AiTimeline
      :entries="chat.entries.value"
      :starters="starters"
      @starter="onStarter"
      @answer="chat.answerAsk"
    />

    <AiComposer
      ref="composer"
      :compose="compose"
      :running="chat.isRunning.value"
      :asking="chat.isAsking.value"
      :hint="hint"
      :last-said="lastSaid"
      :models="models"
      :choice="choice"
      @send="(text) => void chat.send(text)"
      @stop="chat.stop"
      @pick="(value) => emit('pick', value)"
    />
  </aside>
</template>

<style scoped lang="scss">
.ai-panel {
  /* 面板里两条发光分隔线共用的一笔。⚠ 用强调色的 rgb 伴生变量拼出来，
     换主题时跟着全局强调色走，不携带任何一种固定色相 */
  --ai-edge: linear-gradient(
    90deg,
    transparent,
    rgba(var(--accent-primary-rgb), 0.55),
    rgba(var(--accent-secondary-rgb), 0.35),
    transparent
  );

  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  /* ⚠ 这里**不自己画背景**：面板浮在画布上的那一层底（不透明 + 毛玻璃）
     由外面的 AiDock 垫。自己再涂一层半透明的，两层叠起来反而更浑。 */
  background: transparent;
}

.ai-panel__bar {
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
.ai-panel__bar::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1px;
  background: var(--ai-edge);
}

.ai-panel__name {
  color: var(--text-title);
  font-family: var(--font-display);
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
  text-shadow: 0 0 12px var(--fx-glow-title);
}

.ai-panel__where {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 0.75rem;
}
</style>
