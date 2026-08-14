<script setup lang="ts">
/**
 * @fileoverview 兜底控件：递归到顶、或对象字段没声明子字段时，降级成 JSON 编辑。
 * ⚠ 解不出来的文本**不写回**，只在下面挂一条错误：静默丢弃用户的输入等于
 * 「我改了但没反应」，而那是这套系统里最难查的一类故障。
 */
import { DtNotice, DtTextarea } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import type { ConfigControlEmits, ConfigControlProps } from './controlProps'

const props = defineProps<ConfigControlProps>()
const emit = defineEmits<ConfigControlEmits>()

const draft = ref('')
const parseError = ref<string | null>(null)

const serialized = computed(() =>
  props.value === undefined ? '' : JSON.stringify(props.value, null, 2),
)

// 外部改了值（撤销、换选中节点）就把草稿换回来；正在编辑时不打断
watch(serialized, (next) => {
  if (parseError.value === null) draft.value = next
}, { immediate: true })

function commit(text: string): void {
  draft.value = text
  if (text.trim() === '') {
    parseError.value = null
    emit('update', undefined, false)
    return
  }
  try {
    const parsed: unknown = JSON.parse(text)
    parseError.value = null
    emit('update', parsed, false)
  } catch {
    parseError.value = '不是合法的 JSON，这一次没有写回去'
  }
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <DtTextarea
      :model-value="draft"
      size="sm"
      mono
      autosize
      :disabled="disabled === true"
      @update:model-value="commit"
    />
    <DtNotice v-if="parseError" intent="warning" icon="alert-triangle">
      {{ parseError }}
    </DtNotice>
  </div>
</template>
