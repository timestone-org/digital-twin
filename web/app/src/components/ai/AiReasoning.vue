<script setup lang="ts">
/**
 * @fileoverview 模型想的过程：默认摊开着让人看见它在动，想完自动折起来。
 *
 * ⚠ 想完**自动折起**是刻意的：思考动辄比结论长几倍，一直摊着的话用户每次
 * 都要往下翻很久才找得到那句结论。但**用户手动动过之后就不再自动折**——
 * 他既然点开了，就是要读它。
 *
 * ⚠ 这一段**不落库**。重开会话时它不在，所以它只是「此刻看得见」的东西，
 * 不是对话记录的一部分。
 */
import { ref, watch } from 'vue'
import { DtIcon, DtMarkdown } from '@dt/ui'

const props = defineProps<{ text: string; streaming?: boolean }>()

// ⚠ 初值走 watch 的 immediate 而不是在这里读 props：根作用域里读一次
// 就把响应性丢了，而这一格是父组件流式期间一直在改的
const isOpen = ref(false)
const touched = ref(false)

watch(
  () => props.streaming,
  (streaming) => {
    if (streaming === true) isOpen.value = true
    else if (!touched.value) isOpen.value = false
  },
  { immediate: true },
)

function toggle(): void {
  touched.value = true
  isOpen.value = !isOpen.value
}
</script>

<template>
  <li class="ai-think">
    <button
      type="button"
      class="ai-think__head"
      :aria-expanded="isOpen"
      @click="toggle"
    >
      <DtIcon :name="isOpen ? 'chevron-down' : 'chevron-right'" :size="14" />
      <span>{{ streaming ? '正在思考…' : '思考过程' }}</span>
    </button>
    <div v-if="isOpen" class="ai-think__body">
      <DtMarkdown :text="text" />
    </div>
  </li>
</template>

<style scoped lang="scss">
.ai-think {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.ai-think__head {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.25rem;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
}

.ai-think__head:hover {
  color: var(--text-primary);
}

.ai-think__body {
  padding: 0.375rem 0.625rem;
  border-left: 2px solid var(--border-subtle);
  margin-left: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  line-height: 1.6;
}
</style>
