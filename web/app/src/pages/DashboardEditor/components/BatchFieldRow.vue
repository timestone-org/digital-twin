<script setup lang="ts">
/**
 * @fileoverview 批量表单的一行：注册表派发的通用控件 + 「混合」徽标。
 * 用户一改即「统一为此值」，由上层写到全部选中节点。
 */
import { DtTag } from '@dt/ui'
import { computed } from 'vue'

import type { BatchFieldState } from '@/features/dashboard/batchConfig'
import type { ConfigPath } from '@/features/dashboard/configPath'
import ConfigFieldControl from '@/features/dashboard/controls/ConfigFieldControl.vue'

const props = defineProps<{ state: BatchFieldState }>()

const emit = defineEmits<{
  config: [path: ConfigPath, value: unknown, isContinuous: boolean]
}>()

// 布尔/枚举控件摆不出「空」，混合时显示主选中的值；其余控件传 undefined 显示为空
const controlValue = computed(() => {
  if (!props.state.isMixed) return props.state.value
  const type = props.state.field.type
  return type === 'boolean' || type === 'enum' ? props.state.value : undefined
})

function onUpdate(value: unknown, isContinuous: boolean): void {
  emit('config', [props.state.field.key], value, isContinuous)
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div class="flex items-center gap-1.5">
      <span class="text-xs text-text-secondary">{{ state.field.label }}</span>
      <DtTag
        v-if="state.isMixed"
        size="sm"
        intent="warning"
        title="各节点当前值不同；改动会把全部选中统一为新值"
        data-test="batch-mixed"
      >
        混合
      </DtTag>
    </div>
    <ConfigFieldControl
      :field="state.field"
      :value="controlValue"
      :depth="0"
      @update="onUpdate"
    />
    <p v-if="state.field.help" class="m-0 text-2xs text-text-disabled">
      {{ state.field.help }}
    </p>
  </div>
</template>
