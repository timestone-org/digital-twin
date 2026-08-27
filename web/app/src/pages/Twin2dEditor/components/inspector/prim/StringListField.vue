<script setup lang="ts">
/**
 * @fileoverview 一格「按逗号分隔的名单」：变体条件里的标签取值、槽键名单与节点字段
 * 名单共用它。
 *
 * ⚠ 只按逗号切（中英文逗号都收），**不按空白切**：标签值是自由字符串、可以含空格，
 *   按空白切会把 `一号 机组` 拆成两个值，而两个值都对不上任何一个节点——零报错。
 * ⚠ 逐键解析但框里留用户敲的原文：不留的话 `a, b` 删掉末位后那个空格会被一并吃掉，
 *   再打就成了 `a,b`。失焦时把框拨回文档里的值。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import { DtInput } from '@dt/ui'
import { ref, watch } from 'vue'

const props = defineProps<{
  modelValue: readonly string[]
  label?: string
  hint?: string
  error?: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [readonly string[]]
  blur: []
}>()

/** 名单之间的分隔：只按逗号切，中英文逗号都收。 */
const SEP = /[,，]/

/** 框里的原文；文档里存的是它切开之后的样子。 */
const draft = ref('')

/** 焦点还在本控件里；在里面时不拿文档里的值去盖用户正敲着的那半截。 */
const focused = ref(false)

// immediate 兼作初值：在 setup 根作用域直接读 props 会丢响应性
watch(
  () => props.modelValue,
  (value) => {
    if (!focused.value) draft.value = value.join(', ')
  },
  { immediate: true },
)

function onFocusIn(): void {
  focused.value = true
}

function onFocusOut(): void {
  focused.value = false
  draft.value = props.modelValue.join(', ')
  emit('blur')
}

/**
 * 按逗号切、逐段 trim，空段丢掉。
 * @param raw 框里的原文
 */
function parse(raw: string): string[] {
  return raw
    .split(SEP)
    .map((one) => one.trim())
    .filter((one) => one !== '')
}

function write(raw: string): void {
  draft.value = raw
  emit('update:modelValue', parse(raw))
}
</script>

<template>
  <div class="dt-t2-list" @focusin="onFocusIn" @focusout="onFocusOut">
    <DtInput
      :model-value="draft"
      :label="label ?? ''"
      :hint="hint ?? ''"
      :error="error ?? ''"
      :placeholder="placeholder ?? '按逗号分隔'"
      size="sm"
      @update:model-value="write"
    />
  </div>
</template>
