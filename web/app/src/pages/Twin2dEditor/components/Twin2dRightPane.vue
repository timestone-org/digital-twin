<script setup lang="ts">
/**
 * @fileoverview 右栏的顶层分页：属性 / 绑定，两页跟着同一条选中走。
 *
 * ⚠ 分页状态归本组件持有：换选中不该把用户从绑定页踢回属性页——绑一串实体时每选一个
 * 都被踢回去，等于每绑一个点位都要多点一次。
 * ⚠ 两页用 `v-show` 而不是 `v-if`：绑定页上「只看选中的 / 显示全部」那一档是本次会话
 * 的临时取舍，`v-if` 会在每次切回属性页时把它悄悄按回默认，而用户以为自己还在看全部。
 * ⚠ 本层一处字段逻辑都不放，只分页与转发：摊一半进来会让「这个字段在哪改」散成两处。
 */
import type { BindingPayload } from '@dt/contracts'
import type { Twin2dConfig } from '@dt/twin2d'
import { DtSegmented } from '@dt/ui'
import { ref } from 'vue'

import type { Twin2dStyleFocus } from '../scripts/editorSelection'
import type { Twin2dSelection } from '../scripts/types'
import Twin2dBindingPane from './Twin2dBindingPane.vue'
import Twin2dInspector from './Twin2dInspector.vue'

defineProps<{
  /** 整份配置；改动整份产出往上 emit。 */
  config: Twin2dConfig
  /** 当前选中，来自 `editorSelection` 的 `inspect` 派生。 */
  selection: Twin2dSelection
  /** 正在编辑的样式；非空时属性页归它。 */
  styleFocus: Twin2dStyleFocus | null
  /** 图元树上选中的那一枚；空串 = 一枚都没选。 */
  selectedPrim: string
  /** 当前这一份绑定，含还没保存的草稿。 */
  bindings: readonly BindingPayload[]
  /** 有还没保存的改动；有的话新绑的点位这一刻还不会有推送。 */
  isDirty: boolean
}>()

const emit = defineEmits<{
  change: [config: Twin2dConfig]
  merge: [config: Twin2dConfig, key: string]
  endMerge: []
  pickPrim: [primId: string]
  copyPrim: []
  pastePrim: []
  writeBinding: [binding: BindingPayload]
  dropBinding: [fieldKey: string]
  addBinding: [fieldKey: string]
  pickPoint: [fieldKey: string]
  removeBindingRow: [slotKey: string, rowIndex: number]
}>()

/** 两页的键。 */
type Twin2dPaneKey = 'inspect' | 'binding'

const TABS = [
  { value: 'inspect', label: '属性' },
  { value: 'binding', label: '绑定' },
] as const

const pane = ref<Twin2dPaneKey>('inspect')

/**
 * 分段控件给回来的是裸字符串；对不上就当没切。
 * @param value 分段控件给的取值
 */
function onTab(value: string): void {
  const found = TABS.find((item) => item.value === value)
  if (found !== undefined) pane.value = found.value
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-test="twin2d-right-pane">
    <div class="shrink-0 border-b border-border-subtle p-2">
      <DtSegmented
        :model-value="pane"
        :options="TABS"
        size="sm"
        block
        variant="tabs"
        aria-label="右栏分页"
        data-test="right-pane-tabs"
        @update:model-value="onTab"
      />
    </div>

    <Twin2dInspector
      v-show="pane === 'inspect'"
      class="min-h-0 flex-1 overflow-y-auto p-2"
      :config="config"
      :selection="selection"
      :style-focus="styleFocus"
      :selected-prim="selectedPrim"
      @change="emit('change', $event)"
      @merge="(next, key) => emit('merge', next, key)"
      @end-merge="emit('endMerge')"
      @pick-prim="emit('pickPrim', $event)"
      @copy-prim="emit('copyPrim')"
      @paste-prim="emit('pastePrim')"
    />

    <Twin2dBindingPane
      v-show="pane === 'binding'"
      class="min-h-0 flex-1 overflow-y-auto"
      :config="config"
      :bindings="bindings"
      :selection="selection"
      :is-dirty="isDirty"
      @write="emit('writeBinding', $event)"
      @drop="emit('dropBinding', $event)"
      @bind="emit('addBinding', $event)"
      @pick="emit('pickPoint', $event)"
      @remove-row="
        (slotKey, rowIndex) => emit('removeBindingRow', slotKey, rowIndex)
      "
    />
  </div>
</template>
