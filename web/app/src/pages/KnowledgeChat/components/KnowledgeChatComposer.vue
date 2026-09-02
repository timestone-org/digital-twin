<script setup lang="ts">
/**
 * @fileoverview 输入区：一个文本框、发送与停止。
 *
 * ⚠ 不复用助手的 `AiComposer`：那一件焊死了附件与助手的解析接口，而知识库
 * 那边的入参是 `extra="forbid"`，多一格 `user_images` 整个回合就是 400。
 * 这一页的输入是问题，不是资料——要加资料走「知识库管理」的上传。
 *
 * ⚠ 正等着用户在卡片上回答时输入框上锁：不锁的话新消息会与正跑的回合抢同一条
 * 时间线。
 */
import { ref } from 'vue'
import { DtButton, DtTextarea } from '@dt/ui'

const props = defineProps<{
  running: boolean
  asking: boolean
}>()

const emit = defineEmits<{
  send: [text: string]
  stop: []
}>()

const draft = ref('')

function send(): void {
  const text = draft.value.trim()
  if (text === '' || props.running || props.asking) return
  emit('send', text)
  draft.value = ''
}

/** Enter 发送，Shift+Enter 换行。 */
function onEnter(event: KeyboardEvent): void {
  if (event.shiftKey) return
  event.preventDefault()
  send()
}
</script>

<template>
  <div class="flex items-end gap-2 border-t border-border-subtle pt-3">
    <DtTextarea
      v-model="draft"
      class="flex-1"
      autosize
      :disabled="props.asking"
      :placeholder="
        props.asking ? '先回答上面的问题' : '问一句资料里的事…（Enter 发送）'
      "
      aria-label="问知识库"
      @keydown.enter="onEnter"
    />
    <DtButton
      v-if="props.running"
      variant="ghost"
      size="sm"
      icon="square"
      aria-label="停止"
      @click="emit('stop')"
    >
      停止
    </DtButton>
    <DtButton
      v-else
      size="sm"
      icon="send"
      aria-label="发送"
      :disabled="props.asking || draft.trim() === ''"
      @click="send"
    >
      发送
    </DtButton>
  </div>
</template>
