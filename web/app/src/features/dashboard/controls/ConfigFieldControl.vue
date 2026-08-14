<script setup lang="ts">
/**
 * @fileoverview 配置控件的派发口：按 `ConfigField.type` **查注册表**取组件，
 * 不写 switch——加一档控件 = 注册一个组件，编辑器一行不用改
 * （docs/DASHBOARD_DESIGN.md §5.3 陷阱 ④）。
 *
 * ⚠ 查不到一律画出「这一档控件还没登记」：静默留白就是「我选了但没反应」，
 * 那是这套系统里最难查的一类故障（陷阱 ⑤）。
 * ⚠ 递归到顶时降级成 JSON 编辑，判据是**字段自己声明了子结构**
 * （`itemSchema` / `fields`），不是它叫什么类型。
 */
import { getConfigControl } from '@dt/modules'
import { DtNotice } from '@dt/ui'
import { computed, type Component } from 'vue'

import JsonControl from './JsonControl.vue'
import type { ConfigControlEmits, ConfigControlProps } from './controlProps'

const props = defineProps<ConfigControlProps>()
const emit = defineEmits<ConfigControlEmits>()

/** 递归层数上限：再深下去两列表单已经排不开，交给 JSON。 */
const MAX_DEPTH = 3

const depth = computed(() => props.depth ?? 0)

const hasNestedSchema = computed(
  () =>
    props.field.itemSchema !== undefined || props.field.fields !== undefined,
)

const control = computed<Component | undefined>(() => {
  if (depth.value >= MAX_DEPTH && hasNestedSchema.value) return JsonControl
  return getConfigControl(props.field.type)
})
</script>

<template>
  <component
    :is="control"
    v-if="control"
    :field="field"
    :value="value"
    :depth="depth"
    :disabled="disabled"
    @update="
      (next: unknown, isContinuous: boolean) =>
        emit('update', next, isContinuous)
    "
  />
  <DtNotice v-else intent="warning" icon="alert-triangle">
    「{{ field.label }}」这一档控件（{{ field.type }}）还没登记，改不了。
  </DtNotice>
</template>
