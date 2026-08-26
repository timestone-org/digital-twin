<script setup lang="ts">
/**
 * @fileoverview 助手的输入区：一个集成输入框——附件、草稿、模型选择、发送/停止
 * 全在同一个框里，与主流对话组件同一形态。
 *
 * ⚠ 附件解析完挂成**待发条目**而不是灌进草稿：一张两百行的表摊进输入框，
 * 草稿就没法编辑了。每一条点开能看全文——用户仍然先看见助手将要看到什么，
 * 发送时才并进那句话（features/ai/attachment.ts）。
 *
 * ⚠ 键位判定在 features/ai/composeKeys.ts，这里只接线。
 */
import { computed, ref } from 'vue'
import type { AssistantModelProfile } from '@dt/contracts'
import { DtButton, DtFilePicker, DtNotice, DtSpinner, DtTextarea } from '@dt/ui'

import { parseAttachment } from '@/api/assistant'
import AiAttachmentChip from '@/components/ai/AiAttachmentChip.vue'
import AiModelPicker from '@/components/ai/AiModelPicker.vue'
import type { ComposeState, ModelChoice } from '@/composables/useAiPanel'
import {
  ATTACHMENT_ACCEPT,
  toBase64,
  toPending,
  withAttachments,
} from '@/features/ai/attachment'
import { composeKeyOf } from '@/features/ai/composeKeys'

const props = defineProps<{
  /** 草稿与附件。由 useAiPanel 持有：面板收起就卸载，敲了一半的话不能跟着没。 */
  compose: ComposeState
  /** 正在跑回合：发送让位给停止。 */
  running: boolean
  /** 摆在输入框上方的一句提醒，各页面自己给。 */
  hint?: string | undefined
  /** 草稿为空时按 ↑ 召回的上一句话；null = 没得召回。 */
  lastSaid?: string | null | undefined
  /** 这套部署接了哪几路模型。只有一路时下拉整个不渲染（AiModelPicker 管）。 */
  models?: readonly AssistantModelProfile[] | undefined
  /** 这个会话选了哪一路。 */
  choice?: ModelChoice | undefined
}>()

const emit = defineEmits<{
  send: [text: string]
  stop: []
  pick: [value: ModelChoice]
}>()

const canSend = computed(
  () =>
    !props.running &&
    (props.compose.draft.value.trim() !== '' ||
      props.compose.attachments.value.length > 0),
)

function send(): void {
  if (!canSend.value) return
  const text = withAttachments(
    props.compose.draft.value,
    props.compose.attachments.value,
  )
  props.compose.setDraft('')
  props.compose.setAttachments([])
  emit('send', text)
}

function onKeydown(event: KeyboardEvent): void {
  const action = composeKeyOf(event, props.compose.draft.value.trim() !== '')
  if (action === 'send') {
    event.preventDefault()
    send()
    return
  }
  if (action === 'recall' && typeof props.lastSaid === 'string') {
    event.preventDefault()
    props.compose.setDraft(props.lastSaid)
  }
}

const attaching = ref(false)
const attachError = ref('')
/** 点开在看全文的那一条附件；null = 都收着。 */
const previewAt = ref<number | null>(null)

async function attach(files: File[]): Promise<void> {
  const file = files[0]
  if (file === undefined) return
  attaching.value = true
  attachError.value = ''
  try {
    const parsed = await parseAttachment(file.name, await toBase64(file))
    props.compose.setAttachments([
      ...props.compose.attachments.value,
      toPending(file.name, parsed),
    ])
  } catch (error) {
    attachError.value =
      error instanceof Error ? error.message : '读不了这个文件'
  } finally {
    attaching.value = false
  }
}

function removeAt(at: number): void {
  props.compose.setAttachments(
    props.compose.attachments.value.filter((_, index) => index !== at),
  )
  previewAt.value = null
}

/** DtTextarea 暴露出来的那一格。⚠ 用结构类型而不是 InstanceType：组件实例
 * 类型 eslint 的 TS 解析不动，focus 那一下会被判成 unsafe call。 */
const box = ref<{ textareaEl: HTMLTextAreaElement | null } | null>(null)

/** 让外面（开场提示点进来时）能把焦点放回输入框。 */
function focusInput(): void {
  box.value?.textareaEl?.focus()
}

defineExpose({ focusInput })
</script>

<template>
  <form class="ai-compose" @submit.prevent="send">
    <p v-if="hint" class="ai-compose__hint">{{ hint }}</p>

    <DtNotice v-if="attachError" intent="danger">{{ attachError }}</DtNotice>

    <!-- 集成输入框：附件条、草稿、工具行同一个框。焦点环打在框上，
         里面的 DtTextarea 退成裸的（:deep 去壳），不然一个框里套两层边。 -->
    <div class="ai-inputbox">
      <ul
        v-if="compose.attachments.value.length > 0"
        class="ai-inputbox__files"
      >
        <AiAttachmentChip
          v-for="(one, index) in compose.attachments.value"
          :key="`${index}:${one.name}`"
          :attachment="one"
          :expanded="previewAt === index"
          @toggle="previewAt = previewAt === index ? null : index"
          @remove="removeAt(index)"
        />
      </ul>

      <DtTextarea
        ref="box"
        :model-value="compose.draft.value"
        class="ai-inputbox__text"
        :rows="2"
        autosize
        placeholder="说说你想做什么…"
        aria-label="对助手说"
        @update:model-value="compose.setDraft"
        @keydown="onKeydown"
      />

      <div class="ai-inputbox__tools">
        <DtFilePicker
          :accept="ATTACHMENT_ACCEPT"
          :disabled="attaching"
          @select="(files) => void attach(files)"
        >
          <template #default="{ open }">
            <DtButton
              variant="ghost"
              intent="neutral"
              size="sm"
              icon="paperclip"
              :loading="attaching"
              aria-label="附一份参考文件"
              title="附文件：表格附成竖线表，文本原样附上"
              @click="open"
            />
          </template>
        </DtFilePicker>

        <AiModelPicker
          v-if="models !== undefined && choice !== undefined"
          :models="models"
          :choice="choice"
          @pick="(value) => emit('pick', value)"
        />

        <span v-if="running" class="ai-inputbox__busy">
          <DtSpinner :size="12" label="助手正在处理" />
          正在处理…
        </span>
        <span v-else class="ai-inputbox__keys" aria-hidden="true">
          ⏎ 发送 · ⇧⏎ 换行
        </span>

        <DtButton
          v-if="running"
          class="ai-inputbox__go"
          intent="danger"
          size="sm"
          icon="square"
          aria-label="停止这个回合"
          title="停止（Esc）"
          @click="emit('stop')"
        />
        <DtButton
          v-else
          class="ai-inputbox__go"
          type="submit"
          size="sm"
          icon="send"
          aria-label="发送"
          title="发送（Enter）"
          :disabled="!canSend"
        />
      </div>
    </div>
  </form>
</template>

<style scoped lang="scss">
.ai-compose {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem 0.75rem;
  background: var(--surface-raised);
}

/* 与标题栏同款的发光细线，摆在上沿（--ai-edge 声明在面板根上） */
.ai-compose::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 1px;
  background: var(--ai-edge);
}

.ai-compose__hint {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.5;
}

/* —— 集成输入框本体：边、底、焦点环都在这一层 —— */
.ai-inputbox {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.ai-inputbox:focus-within {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb), 0.18);
}

/* 里面的 DtTextarea 去壳：壳（边、底、焦点环）已经由外框统一画了 */
.ai-inputbox__text :deep(.dt-textarea) {
  padding: 0.5rem 0.75rem 0.25rem;
  border: none;
  background: transparent;
}

.ai-inputbox__text :deep(.dt-textarea:focus-within) {
  box-shadow: none;
}

.ai-inputbox__files {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0;
  padding: 0.5rem 0.5rem 0;
  list-style: none;
}

/* —— 框内工具行：附件、模型、状态、发送 —— */
.ai-inputbox__tools {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.375rem 0.375rem;
}

/* 模型下拉一齐摆上时空间紧，被挤到放不下就整段隐去——它只是提示，不是功能 */
.ai-inputbox__keys {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text-disabled);
  font-size: 0.6875rem;
  text-align: right;
  white-space: nowrap;
}

.ai-inputbox__busy {
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: flex-end;
  gap: 0.375rem;
  color: var(--text-secondary);
  font-size: 0.75rem;
  white-space: nowrap;
}

/* 发送/停止：主流对话组件的圆形动作键 */
.ai-inputbox__go {
  border-radius: 50%;
}
</style>
