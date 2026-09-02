<script setup lang="ts">
/**
 * @fileoverview 集成输入框的壳：外框与焦点环、附件槽、工具行（键位提示 / 忙碌）、
 * 圆形发送与停止键。助手与知识库对话共用——同一形态各画一份必然漂。
 *
 * ⚠ 文本框由调用方放进默认槽，壳（边、底、焦点环）只在这一层画：里面的
 * DtTextarea 经 `:deep` 去壳，不然一个框里套两层边。
 */
import { computed } from 'vue'
import { DtButton, DtSpinner } from '@dt/ui'

const props = defineProps<{
  /** 正在跑回合：发送让位给停止。 */
  running: boolean
  canSend: boolean
  busyLabel?: string | undefined
  keysHint?: string | undefined
  sendLabel?: string | undefined
  stopLabel?: string | undefined
  sendTitle?: string | undefined
  stopTitle?: string | undefined
}>()

const emit = defineEmits<{
  send: []
  stop: []
}>()

// ⚠ 缺省值不走 withDefaults：开着 exactOptionalPropertyTypes 时它不收窄读取端，
// 往 DtSpinner 的 label 里传会整条 typecheck 红（同 DtButton 的 size）
const text = computed(() => ({
  busy: props.busyLabel ?? '正在处理…',
  keys: props.keysHint ?? '⏎ 发送 · ⇧⏎ 换行',
  send: props.sendLabel ?? '发送',
  stop: props.stopLabel ?? '停止这个回合',
  sendTitle: props.sendTitle ?? '发送（Enter）',
  stopTitle: props.stopTitle ?? '停止（Esc）',
}))
</script>

<template>
  <div class="ai-inputbox">
    <!-- 附件条只在调用方给了槽时才有：空的 ul 也带内边距，会把框顶出一截 -->
    <ul v-if="$slots.files" class="ai-inputbox__files">
      <slot name="files" />
    </ul>

    <div class="ai-inputbox__text">
      <slot />
    </div>

    <div class="ai-inputbox__tools">
      <slot name="tools" />

      <span v-if="running" class="ai-inputbox__busy">
        <DtSpinner :size="12" :label="text.busy" />
        <span aria-hidden="true">{{ text.busy }}</span>
      </span>
      <span v-else class="ai-inputbox__keys" aria-hidden="true">
        {{ text.keys }}
      </span>

      <DtButton
        v-if="running"
        class="ai-inputbox__go"
        intent="danger"
        size="sm"
        icon="square"
        :aria-label="text.stop"
        :title="text.stopTitle"
        @click="emit('stop')"
      />
      <DtButton
        v-else
        class="ai-inputbox__go"
        type="button"
        size="sm"
        icon="send"
        :aria-label="text.send"
        :title="text.sendTitle"
        :disabled="!canSend"
        @click="emit('send')"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
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

/* —— 框内工具行：调用方的工具、状态、发送 —— */
.ai-inputbox__tools {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.375rem 0.375rem;
}

/* 工具一齐摆上时空间紧，被挤到放不下就整段隐去——它只是提示，不是功能 */
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

@media (prefers-reduced-motion: reduce) {
  .ai-inputbox {
    transition: none;
  }
}
</style>
