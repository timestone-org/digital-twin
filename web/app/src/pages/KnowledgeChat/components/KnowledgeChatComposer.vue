<script setup lang="ts">
/**
 * @fileoverview 输入区：一个文本框、发送与停止，壳用共用的 AiInputBox。
 *
 * ⚠ 不复用助手的 `AiComposer`：那一件焊死了附件与助手的解析接口，而知识库
 * 那边的入参是 `extra="forbid"`，多一格 `user_images` 整个回合就是 400。
 * 这一页的输入是问题，不是资料——要加资料走「知识库管理」的上传。
 *
 * ⚠ 正等着用户在卡片上回答时输入框上锁：不锁的话新消息会与正跑的回合抢同一条
 * 时间线。
 *
 * ⚠ Enter 不自己判，走 `features/ai/composeKeys.ts` 与助手同一套：IME 选字那一下
 * 也是 Enter，自己判会把半截拼音发出去。
 */
import { computed, ref } from 'vue'
import { DtTextarea } from '@dt/ui'

import AiInputBox from '@/components/ai/AiInputBox.vue'
import { composeKeyOf } from '@/features/ai/composeKeys'

const props = defineProps<{
  running: boolean
  asking: boolean
}>()

const emit = defineEmits<{
  send: [text: string]
  stop: []
}>()

const draft = ref('')

const canSend = computed(
  () => !props.running && !props.asking && draft.value.trim() !== '',
)

function send(): void {
  if (!canSend.value) return
  emit('send', draft.value.trim())
  draft.value = ''
}

/** Enter 发送，Shift+Enter 换行；↑ 召回这一页没有，一律放行给 textarea。 */
function onKeydown(event: KeyboardEvent): void {
  if (composeKeyOf(event, draft.value.trim() !== '') !== 'send') return
  event.preventDefault()
  send()
}
</script>

<template>
  <div class="kb-compose">
    <AiInputBox
      :running="props.running"
      :can-send="canSend"
      stop-label="停止"
      @send="send"
      @stop="emit('stop')"
    >
      <DtTextarea
        v-model="draft"
        autosize
        :disabled="props.asking"
        :placeholder="props.asking ? '先回答上面的问题' : '问一句资料里的事…'"
        aria-label="问知识库"
        @keydown="onKeydown"
      />
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
</style>
