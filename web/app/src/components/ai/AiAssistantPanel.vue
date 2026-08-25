<script setup lang="ts">
/**
 * @fileoverview 助手面板：外框、时间线、输入框。
 *
 * ⚠ 助手改的是**草稿**，保存永远由用户自己按。面板上一直摆着这句话——
 * 漏了它，用户会以为绑完就落库了，然后关掉标签页。
 *
 * ⚠ 时间线怎么摆在 `AiTimeline`，正文怎么渲染在 `AiMarkdown`：这里只负责
 * 把它们与一次对话接起来。
 */
import { computed, ref } from 'vue'
import type { AssistantSurfaceKind } from '@dt/contracts'
import { DtButton, DtFilePicker, DtNotice, DtSpinner, DtTextarea } from '@dt/ui'

import { parseAttachment } from '@/api/assistant'
import AiCoreIcon from '@/components/ai/AiCoreIcon.vue'
import AiTimeline from '@/components/ai/AiTimeline.vue'
import { toBase64 } from '@/features/ai/attachment'
import { useAiConversation } from '@/composables/useAiConversation'

const props = defineProps<{
  surfaceKind: AssistantSurfaceKind
  surfaceLabel: string
  sessionId: string | null
  /** 摆在输入框上方的一句提醒，各页面自己给。 */
  hint?: string
  /** 面板此刻是不是放大着。宽窄由外面的 dock 管，这里只画那个按钮。 */
  isWide?: boolean
}>()

const emit = defineEmits<{ close: []; 'toggle-wide': [] }>()

const draft = ref('')

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

const attaching = ref(false)
const attachError = ref('')

/**
 * 读一张点表，把它摊平之后附在草稿后面。
 * ⚠ 附进**草稿**而不是直接发出去：用户得先看见助手将要看到什么，
 * 这一点比省几下点击重要。
 */
async function attach(files: File[]): Promise<void> {
  const file = files[0]
  if (file === undefined) return
  attaching.value = true
  attachError.value = ''
  try {
    const table = await parseAttachment(file.name, await toBase64(file))
    const note = table.is_truncated
      ? `（只读了前 ${table.rows.length} 行，共 ${table.total_rows} 行）`
      : ''
    draft.value = `${draft.value}\n\n参考点表 ${file.name}${note}：\n${table.text}`
  } catch (error) {
    attachError.value =
      error instanceof Error ? error.message : '读不了这个文件'
  } finally {
    attaching.value = false
  }
}
</script>

<template>
  <aside class="ai-panel" aria-label="AI 助手">
    <div class="ai-panel__bar">
      <AiCoreIcon :size="20" />
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
      <DtButton
        variant="ghost"
        size="xs"
        :icon="isWide ? 'chevron-right' : 'chevron-left'"
        :aria-label="isWide ? '缩小助手面板' : '放大助手面板'"
        @click="emit('toggle-wide')"
      />
      <DtButton variant="ghost" size="xs" icon="close" @click="emit('close')">
        收起
      </DtButton>
    </div>

    <AiTimeline :entries="chat.entries.value" />

    <div v-if="chat.isRunning.value" class="ai-panel__busy">
      <DtSpinner :size="14" label="助手正在处理" />
      <span>正在处理…</span>
      <DtButton variant="ghost" size="xs" @click="chat.stop">停下</DtButton>
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
      <DtNotice v-if="attachError" intent="danger">{{ attachError }}</DtNotice>
      <div class="ai-panel__actions">
        <DtFilePicker
          label="附点表"
          accept=".csv,.xlsx,.xlsm"
          :disabled="attaching"
          @select="(files) => void attach(files)"
        />
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
  /* ⚠ 这里**不再自己画背景**：面板既可能嵌在页面里，也可能浮在画布上，
     而浮着的那一路由外面那层（AiDock）垫不透明底。自己再涂一层半透明的，
     两层叠起来反而更浑。 */
  background: transparent;
}

.ai-panel__bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border-default);
  /* 标题栏压一层更实的底，滚动内容从它下面过时不会糊在一起 */
  background: var(--surface-raised);
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

.ai-panel__busy {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.75rem;
  color: var(--text-secondary);
  font-size: 0.8125rem;
}

.ai-panel__compose {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  border-top: 1px solid var(--border-default);
  background: var(--surface-raised);
}

.ai-panel__hint {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.5;
}

.ai-panel__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
</style>
