<script setup lang="ts">
/**
 * @fileoverview 内联重命名输入框：挂载即聚焦全选，Enter 提交、Esc 取消、失焦提交。
 *
 * ⚠ 三条出口只许结算一次：按 Esc 会紧接着触发一次 blur，不加闸就变成
 * 「取消之后又提交了一遍」，用户明明按了 Esc 名字却还是改掉了。
 */
import { onMounted, ref, watch } from 'vue'
import { DtInput } from '@dt/ui'

/**
 * ⚠ 不写 `InstanceType<typeof DtInput>`：`.vue` 导出的类型 typescript-eslint
 * 解析不出来，整段会被当成 any 报一片 unsafe。
 */
interface InputHandle {
  inputEl: HTMLInputElement | null
}

const props = defineProps<{ value: string; label: string }>()

const emit = defineEmits<{ commit: [name: string]; cancel: [] }>()

const draft = ref('')
const field = ref<InputHandle | null>(null)
let isSettled = false

// 初值只取一次：父组件随后刷新列表时不该盖掉用户正在输入的内容
const stopSync = watch(
  () => props.value,
  (next) => (draft.value = next),
  {
    immediate: true,
  },
)
stopSync()

onMounted(() => {
  const element = field.value?.inputEl
  element?.focus()
  element?.select()
})

function commit(): void {
  if (isSettled) return
  isSettled = true
  const name = draft.value.trim()
  if (name === '' || name === props.value) emit('cancel')
  else emit('commit', name)
}

function cancel(): void {
  if (isSettled) return
  isSettled = true
  emit('cancel')
}

function onKeystate(event: KeyboardEvent): void {
  if (event.key === 'Escape') cancel()
}
</script>

<template>
  <DtInput
    ref="field"
    v-model="draft"
    size="sm"
    class="min-w-0 flex-1"
    :aria-label="label"
    data-test="inline-rename"
    @enter="commit"
    @keystate="onKeystate"
    @blur="commit"
    @click.stop
  />
</template>
