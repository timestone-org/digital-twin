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

import type { Twin2dPick, Twin2dStyleFocus } from '../scripts/editorSelection'
import type { Twin2dSelection } from '../scripts/types'
import Twin2dArrangePanel from './Twin2dArrangePanel.vue'
import Twin2dBindingPane from './Twin2dBindingPane.vue'
import Twin2dInspector from './Twin2dInspector.vue'

defineProps<{
  /** 整份配置；改动整份产出往上 emit。 */
  config: Twin2dConfig
  /** 当前选中，来自 `editorSelection` 的 `inspect` 派生。 */
  selection: Twin2dSelection
  /**
   * 画布上选中的**那一批**；批量摆位读它，检查器读的是上面那条单选派生。
   * ⚠ 两条不能合成一条：检查器要的是「最后点的那一个」，摆位要的是「一共点了哪些」，
   * 合成一条的话总有一边只拿得到另一边要的东西。
   */
  pick: Twin2dPick | null
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
    <div class="shrink-0 p-2">
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

    <!--
      摆位那一段钉在顶上不跟着滚：一边看着图上那一批、一边按键，滚走了就得来回找。
      ⚠ 它与检查器各自挂各自的 `v-show`，不共用一个外壳：整页的显隐落在检查器**自己**
      的根节点上是既有契约（用例按那上头的行内 display 判两页有没有同时摆着），套一层
      外壳会让那个判据永远读到「显示着」。
      ⚠ 一批都没选时里面整个不画，这只空壳没有边框也没有内边距，于是不占一格高。
    -->
    <div v-show="pane === 'inspect'" class="shrink-0">
      <Twin2dArrangePanel
        class="border-b border-border-subtle p-2"
        :config="config"
        :pick="pick"
        @change="emit('change', $event)"
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
