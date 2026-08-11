<script setup lang="ts">
/**
 * @fileoverview DtFilePicker —— 藏起来的原生 file input + 一个触发器。
 * 默认插槽拿到 `open`，自备触发区（拖拽区、工具栏图标）的宿主用它复用同一套选取逻辑。
 */
import { ref } from 'vue'
import { DT_CONTROL_DEFAULT_SIZE } from '@dt/contracts'
import type { DtSize } from '@dt/contracts'
import DtButton from '../DtButton/DtButton.vue'

const props = withDefaults(
  defineProps<{
    /** 缺省触发按钮的文案；给了默认插槽就由插槽接管。 */
    label?: string | undefined
    accept?: string | undefined
    multiple?: boolean | undefined
    size?: DtSize | undefined
    disabled?: boolean | undefined
  }>(),
  {
    label: '选择文件',
    multiple: false,
    size: DT_CONTROL_DEFAULT_SIZE,
    disabled: false,
  },
)

const emit = defineEmits<{ select: [files: File[]] }>()

const inputEl = ref<HTMLInputElement | null>(null)

function open(): void {
  if (props.disabled === true) return
  inputEl.value?.click()
}

function onChange(event: Event): void {
  const el = event.target as HTMLInputElement
  const files = [...(el.files ?? [])]
  // ⚠ 先清空再 emit：不清空的话连续选同一个文件不会再触发 change，用户会以为按钮坏了；
  // 而放到 emit 之后清，宿主在处理里同步再次唤起选取时会被这一下清掉。
  el.value = ''
  if (files.length > 0) emit('select', files)
}

defineExpose({ open })
</script>

<template>
  <span class="dt-file-picker">
    <slot :open="open" :disabled="disabled">
      <DtButton
        variant="outline"
        intent="neutral"
        icon="upload"
        :size="size"
        :disabled="disabled"
        @click="open"
      >
        {{ label }}
      </DtButton>
    </slot>
    <!-- ⚠ 用 display:none 藏会让部分浏览器直接跳过 click() 唤起对话框，只能压成零尺寸 -->
    <input
      ref="inputEl"
      type="file"
      class="dt-file-picker__native"
      :accept="accept"
      :multiple="multiple"
      :disabled="disabled"
      tabindex="-1"
      aria-hidden="true"
      @change="onChange"
    />
  </span>
</template>

<style scoped lang="scss">
.dt-file-picker {
  position: relative;
  display: inline-flex;

  &__native {
    position: absolute;
    width: 0;
    height: 0;
    padding: 0;
    border: 0;
    opacity: 0;
    pointer-events: none;
  }
}
</style>
