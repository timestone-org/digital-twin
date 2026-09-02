<script setup lang="ts">
/**
 * @fileoverview 输入区：一个文本框、发送与停止，壳用共用的 AiInputBox；接了语音
 * 识别的部署多一枚麦克风键，转写接在草稿后面（`features/speech`，ADR-0038）。
 *
 * ⚠ 不复用助手的 `AiComposer`：那一件焊死了附件与助手的解析接口，而知识库
 * 那边的入参是 `extra="forbid"`，多一格 `user_images` 整个回合就是 400。
 * 这一页的输入是问题，不是资料——要加资料走「知识库管理」的上传。
 *
 * ⚠ 正等着用户在卡片上回答时输入框上锁：不锁的话新消息会与正跑的回合抢同一条
 * 时间线。麦克风同一条理由一起禁。
 *
 * ⚠ Enter 不自己判，走 `features/ai/composeKeys.ts` 与助手同一套：IME 选字那一下
 * 也是 Enter，自己判会把半截拼音发出去。
 *
 * ⚠ 录音中文本框不锁，用户可以顺手改；但每帧转写回来都按「开始录音那一刻的草稿
 * + 整段转写」整体覆盖，改在转写那一截里的字会被下一帧冲掉。
 */
import { computed, ref, watch } from 'vue'
import { DtButton, DtNotice, DtTextarea } from '@dt/ui'

import AiInputBox from '@/components/ai/AiInputBox.vue'
import { composeKeyOf } from '@/features/ai/composeKeys'
import { useSpeechInput } from '@/features/speech/useSpeechInput'

const props = defineProps<{
  running: boolean
  asking: boolean
  /** 这套部署接了语音识别（能力接口的 `is_asr_enabled`）。 */
  speechEnabled: boolean
}>()

const emit = defineEmits<{
  send: [text: string]
  stop: []
}>()

const draft = ref('')
const speech = useSpeechInput()
/** DtTextarea 暴露出来的那一格。⚠ 用结构类型而不是 InstanceType（同 AiComposer）。 */
const box = ref<{ textareaEl: HTMLTextAreaElement | null } | null>(null)
/** 开始录音那一刻草稿里已有的字；转写接在它后面。 */
let base = ''

const canSend = computed(
  () => !props.running && !props.asking && draft.value.trim() !== '',
)
const isRecording = computed(
  () =>
    speech.status.value === 'connecting' || speech.status.value === 'listening',
)
const isFinishing = computed(() => speech.status.value === 'finishing')
const micLabel = computed(() =>
  isRecording.value ? '结束语音输入' : '开始语音输入',
)
const micTitle = computed(() =>
  isRecording.value ? '说完再点一下' : '按一下开始说话，说完再点一下',
)

/** 转写接在已有草稿后面：末尾没有空白就补一个空格。 */
function joinable(text: string): string {
  return text === '' || /\s$/.test(text) ? text : `${text} `
}

function toggleSpeech(): void {
  if (isRecording.value) {
    speech.stop()
    return
  }
  if (isFinishing.value) return
  base = joinable(draft.value)
  void speech.start()
}

// 每帧转写都是整段：直接盖掉 base 之后的部分。取消时转写清空，草稿就回到 base
watch(speech.transcript, (text) => {
  draft.value = base + text
})

// 说完整理好了，焦点回到文本框，接着改或者直接发
watch(speech.status, (now, before) => {
  if (now === 'idle' && before === 'finishing') box.value?.textareaEl?.focus()
})

function send(): void {
  if (!canSend.value) return
  emit('send', draft.value.trim())
  draft.value = ''
}

/** Enter 发送，Shift+Enter 换行；录音中 Esc 作废这一句；其余放行给 textarea。 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && (isRecording.value || isFinishing.value)) {
    event.preventDefault()
    speech.cancel()
    return
  }
  if (composeKeyOf(event, draft.value.trim() !== '') !== 'send') return
  event.preventDefault()
  send()
}
</script>

<template>
  <div class="kb-compose">
    <DtNotice v-if="speech.error.value !== ''" intent="danger" class="mb-2">
      {{ speech.error.value }}
    </DtNotice>

    <AiInputBox
      :running="props.running"
      :can-send="canSend"
      stop-label="停止"
      @send="send"
      @stop="emit('stop')"
    >
      <DtTextarea
        ref="box"
        v-model="draft"
        autosize
        :disabled="props.asking"
        :placeholder="props.asking ? '先回答上面的问题' : '问一句资料里的事…'"
        aria-label="问知识库"
        @keydown="onKeydown"
      />

      <template v-if="props.speechEnabled" #tools>
        <!-- pressed 一给，外观就由它定（DtButton），所以不再写 variant / intent -->
        <DtButton
          size="sm"
          icon="mic"
          :pressed="isRecording"
          :disabled="props.asking || isFinishing"
          :aria-label="micLabel"
          :title="micTitle"
          @click="toggleSpeech"
        />
        <span
          v-if="isRecording || isFinishing"
          class="kb-compose__listening text-xs text-text-secondary"
          aria-live="polite"
        >
          <span
            class="kb-compose__dot motion-safe:animate-pulse"
            aria-hidden="true"
          />
          {{ isFinishing ? '整理中…' : '正在听…' }}
        </span>
      </template>
    </AiInputBox>
  </div>
</template>

<style scoped lang="scss">
.kb-compose {
  position: relative;
  padding: 0.625rem 0.75rem 0.75rem;
  background: var(--surface-raised);
}

/* 与标题栏同款的发光细线，摆在上沿（--ai-edge 声明在 ChatPanel 的根上） */
.kb-compose::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 1px;
  background: var(--ai-edge);
}

/* 与时间线的消息列同宽同轴（ChatPanel 里钉的 56rem），发送键才对得上右对齐的自己那条 */
.kb-compose :deep(.ai-inputbox),
.kb-compose :deep(.dt-notice) {
  max-width: 56rem;
  margin-inline: auto;
}

.kb-compose__listening {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  white-space: nowrap;
}

/* 录音指示的小红点；闪不闪由 motion-safe:animate-pulse 定，尊重 reduced-motion */
.kb-compose__dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--state-danger);
}
</style>
