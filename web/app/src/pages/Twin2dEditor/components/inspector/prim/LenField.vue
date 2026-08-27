<script setup lang="ts">
/**
 * @fileoverview 一格长度：裸数是设计像素，另有 `%` / `em` / `auto` 三种串形。
 * 图元的 `size` 两边、`minWidth` / `maxWidth` 与变体补丁里的同名格共用它。
 *
 * ⚠ 逐键解析，**解析不出就不写回文档**（`5e` 是 `5em` 打到一半）：写回去会把它压成
 *   0，于是 `em` 与小数点永远打不完。失焦时把框拨回文档里的值。
 * ⚠ 判据只借 `optionalLen` 一份，不在这里另写一条正则：另写的那份一旦比它松，
 *   文档里就会存下一个归一化照样会顶掉的取值——表现是「配了不生效」，零报错。
 * ⚠ `nullable` 那一档下空框是**有意义的一档**（这一格不给），不是「没打完」：
 *   两者混作一处会让 `maxWidth` 一旦填过就再也清不掉。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import { optionalLen } from '@dt/twin2d'
import type { Twin2dLen } from '@dt/twin2d'
import { DtInput } from '@dt/ui'
import { ref, watch } from 'vue'

const props = defineProps<{
  modelValue: Twin2dLen | null
  label?: string
  hint?: string
  placeholder?: string
  /** 收不收「空框 = 这一格不给」；不给这个键时空框只当没打完。 */
  nullable?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [Twin2dLen | null]
  blur: []
}>()

/** 框里的原文；文档里存的是它解析之后的样子。 */
const draft = ref('')

/** 焦点还在本控件里；在里面时不拿文档里的值去盖用户正敲着的那半截。 */
const focused = ref(false)

/**
 * 文档里的长度 → 框里的文本；缺席是空框。
 * @param len 文档里的取值
 */
function textOf(len: Twin2dLen | null): string {
  if (len === null) return ''
  return typeof len === 'number' ? String(len) : len
}

// immediate 兼作初值：在 setup 根作用域直接读 props 会丢响应性
watch(
  () => props.modelValue,
  (value) => {
    if (!focused.value) draft.value = textOf(value)
  },
  { immediate: true },
)

function onFocusIn(): void {
  focused.value = true
}

function onFocusOut(): void {
  focused.value = false
  draft.value = textOf(props.modelValue)
  emit('blur')
}

function write(raw: string): void {
  draft.value = raw
  const len = optionalLen(raw)
  if (len !== null) {
    emit('update:modelValue', len)
    return
  }
  if (props.nullable === true && raw.trim() === '') {
    emit('update:modelValue', null)
  }
}
</script>

<template>
  <div class="dt-t2-len" @focusin="onFocusIn" @focusout="onFocusOut">
    <DtInput
      :model-value="draft"
      :label="label ?? ''"
      :hint="hint ?? ''"
      :placeholder="placeholder ?? '24 / 50% / 1.5em / auto'"
      size="sm"
      @update:model-value="write"
    />
  </div>
</template>
