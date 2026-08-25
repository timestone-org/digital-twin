<script setup lang="ts">
/**
 * @fileoverview 助手面板：对话、逐步可见的动作、以及输入框。
 *
 * ⚠ 步骤与对话摆在**同一条时间线**上，不分两栏。分开的话，用户要在两处之间
 * 来回对时间才能看出「它是先查了点位再绑的」，而那正是这个面板要交代的事。
 *
 * ⚠ 助手改的是**草稿**，保存永远由用户自己按。面板上一直摆着这句话——
 * 漏了它，用户会以为绑完就落库了，然后关掉标签页。
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { AssistantSurfaceKind } from '@dt/contracts'
import { DtButton, DtEmpty, DtIcon, DtNotice, DtSpinner, DtTextarea } from '@dt/ui'

import AiStepRow from '@/components/ai/AiStepRow.vue'
import { useAiConversation } from '@/composables/useAiConversation'

const props = defineProps<{
  surfaceKind: AssistantSurfaceKind
  surfaceLabel: string
  sessionId: string | null
  /** 摆在输入框上方的一句提醒，各页面自己给。 */
  hint?: string
}>()

const emit = defineEmits<{ close: [] }>()

const draft = ref('')
const scroller = ref<HTMLElement | null>(null)

const chat = useAiConversation(
  () => props.sessionId,
  () => ({ kind: props.surfaceKind, label: props.surfaceLabel }),
)

const canSend = computed(
  () => draft.value.trim() !== '' && !chat.isRunning.value,
)

async function send(): Promise<void> {
  if (!canSend.value) return
  const text = draft.value.trim()
  draft.value = ''
  await chat.send(text)
}

// 新内容一律滚到底：不滚的话，助手在做第三步时用户还盯着第一步
watch(
  () => chat.entries.value.length,
  async () => {
    await nextTick()
    const box = scroller.value
    if (box !== null) box.scrollTop = box.scrollHeight
  },
)
</script>

<template>
  <aside class="ai-panel" aria-label="AI 助手">
    <div class="ai-panel__bar">
      <DtIcon name="sparkles" :size="16" class="ai-panel__badge" />
      <span class="ai-panel__name">助手</span>
      <span class="ai-panel__where">{{ surfaceLabel }}</span>
      <DtButton
        variant="ghost"
        size="xs"
        icon="trash"
        :disabled="chat.entries.value.length === 0"
        @click="chat.clear"
      >
        清空
      </DtButton>
      <DtButton variant="ghost" size="xs" icon="close" @click="emit('close')">
        收起
      </DtButton>
    </div>

    <div ref="scroller" class="ai-panel__stream">
      <DtEmpty
        v-if="chat.entries.value.length === 0"
        icon="sparkles"
        title="说说你想做什么"
        hint="比如「把 1 号机组的温度绑到这个数值卡上」"
      />
      <ul v-else class="ai-panel__list">
        <template v-for="entry in chat.entries.value" :key="entry.id">
          <li v-if="entry.role === 'user'" class="ai-said ai-said--mine">
            {{ entry.text }}
          </li>
          <li v-else-if="entry.role === 'assistant'" class="ai-said">
            {{ entry.text }}
          </li>
          <li v-else-if="entry.role === 'error'" class="ai-said ai-said--bad">
            <DtNotice intent="danger">{{ entry.text }}</DtNotice>
          </li>
          <AiStepRow v-else-if="entry.step" :step="entry.step" />
        </template>
        <li v-if="chat.isRunning.value" class="ai-panel__busy">
          <DtSpinner :size="14" label="助手正在处理" />
          <span>正在处理…</span>
          <DtButton variant="ghost" size="xs" @click="chat.stop">停下</DtButton>
        </li>
      </ul>
    </div>

    <form class="ai-panel__compose" @submit.prevent="send">
      <p v-if="hint" class="ai-panel__hint">{{ hint }}</p>
      <DtTextarea
        v-model="draft"
        :rows="2"
        autosize
        placeholder="说说你想做什么…"
        aria-label="对助手说"
      />
      <div class="ai-panel__actions">
        <DtButton type="submit" size="sm" :disabled="!canSend">发送</DtButton>
      </div>
    </form>
  </aside>
</template>

<style scoped lang="scss">
.ai-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--surface-panel);
  border-left: 1px solid var(--border-default);
}

.ai-panel__bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border-subtle);
}

.ai-panel__badge {
  color: var(--accent-primary);
}

.ai-panel__name {
  color: var(--text-title);
  font-weight: 600;
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

.ai-panel__stream {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.75rem;
}

.ai-panel__list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-said {
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  color: var(--text-primary);
  font-size: 0.875rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-said--mine {
  align-self: flex-end;
  max-width: 85%;
  background: var(--surface-raised);
  color: var(--text-title);
}

.ai-said--bad {
  padding: 0;
  background: transparent;
}

.ai-panel__busy {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  color: var(--text-secondary);
  font-size: 0.8125rem;
}

.ai-panel__compose {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  border-top: 1px solid var(--border-subtle);
}

.ai-panel__hint {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.5;
}

.ai-panel__actions {
  display: flex;
  justify-content: flex-end;
}
</style>
