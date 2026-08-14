<script setup lang="ts">
/**
 * @fileoverview `type: 'object'` 的控件：按 `fields` 递归摊出子表单。
 * ⚠ 没声明 `fields` 的对象字段降级成 JSON 编辑，绝不静默画成空白——
 * 孪生场景那种 `Vec3` + `Record<string,string>` 混着的形状，两列通用表单表达不了，
 * 但「表达不了」不等于「不给改」。
 */
import { readRecord } from '@dt/modules'
import { DtField } from '@dt/ui'
import { computed } from 'vue'

import ConfigFieldControl from './ConfigFieldControl.vue'
import JsonControl from './JsonControl.vue'
import type { ConfigControlEmits, ConfigControlProps } from './controlProps'

const props = defineProps<ConfigControlProps>()
const emit = defineEmits<ConfigControlEmits>()

const record = computed(() => readRecord(props.value))
const fields = computed(() => props.field.fields ?? [])
const depth = computed(() => (props.depth ?? 0) + 1)

function writeKey(key: string, next: unknown, isContinuous: boolean): void {
  emit('update', { ...record.value, [key]: next }, isContinuous)
}
</script>

<template>
  <JsonControl
    v-if="fields.length === 0"
    :field="field"
    :value="value"
    :depth="depth"
    :disabled="disabled"
    @update="(next: unknown, live: boolean) => emit('update', next, live)"
  />
  <div v-else class="flex flex-col gap-3 rounded border border-border-subtle p-3">
    <DtField
      v-for="sub in fields"
      :key="sub.key"
      :label="sub.label"
      :hint="sub.help"
      size="sm"
    >
      <ConfigFieldControl
        :field="sub"
        :value="record[sub.key]"
        :depth="depth"
        :disabled="disabled"
        @update="
          (next: unknown, live: boolean) => writeKey(sub.key, next, live)
        "
      />
    </DtField>
  </div>
</template>
