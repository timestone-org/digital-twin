<script setup lang="ts">
/**
 * @fileoverview 右栏的顶层分页：属性 / 绑定，两页都跟着当前选中走。
 *
 * ⚠ 分页状态归本组件持有：换选中不该把用户从绑定页踢回属性页——绑一串实体时
 * 每选一个都被踢回去，等于每绑一个点位都要多点一次。
 */
import type { BindingPayload } from '@dt/contracts'
import type { GizmoMode } from '@dt/three-core'
import type { TwinConfig } from '@dt/twin-config'
import { DtSegmented } from '@dt/ui'
import { ref } from 'vue'

import type { TwinSelection } from '../scripts/types'
import TwinBindingPane from './TwinBindingPane.vue'
import TwinInspector from './TwinInspector.vue'

defineProps<{
  config: TwinConfig
  selection: TwinSelection
  modelNodes: readonly string[]
  picking: boolean
  roamPreviewing: boolean
  gizmoMode: GizmoMode
  bindings: readonly BindingPayload[]
  isDirty: boolean
}>()

const emit = defineEmits<{
  patch: [Partial<TwinConfig>]
  requestPick: ['node' | 'position']
  cancelPick: []
  captureCamera: [string]
  captureHierView: [string]
  previewRoam: []
  stopRoamPreview: []
  'update:gizmoMode': [GizmoMode]
  writeBinding: [binding: BindingPayload]
  dropBinding: [fieldKey: string]
  addBinding: [fieldKey: string]
  pickPoint: [fieldKey: string]
  removeBindingRow: [slotKey: string, rowIndex: number]
}>()

type PaneKey = 'inspect' | 'binding'

const TABS = [
  { value: 'inspect', label: '属性' },
  { value: 'binding', label: '绑定' },
] as const

const pane = ref<PaneKey>('inspect')

/** 分段控件给回来的是裸字符串；对不上就当没切。 */
function onTab(value: string): void {
  const found = TABS.find((item) => item.value === value)
  if (found !== undefined) pane.value = found.value
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="shrink-0 border-b border-border-subtle p-2">
      <DtSegmented
        :model-value="pane"
        :options="TABS"
        size="sm"
        block
        variant="tabs"
        aria-label="右栏分页"
        @update:model-value="onTab"
      />
    </div>

    <TwinInspector
      v-if="pane === 'inspect'"
      class="min-h-0 flex-1 overflow-y-auto"
      :config="config"
      :selection="selection"
      :model-nodes="modelNodes"
      :picking="picking"
      :roam-previewing="roamPreviewing"
      :gizmo-mode="gizmoMode"
      @patch="emit('patch', $event)"
      @request-pick="emit('requestPick', $event)"
      @cancel-pick="emit('cancelPick')"
      @capture-camera="emit('captureCamera', $event)"
      @capture-hier-view="emit('captureHierView', $event)"
      @preview-roam="emit('previewRoam')"
      @stop-roam-preview="emit('stopRoamPreview')"
      @update:gizmo-mode="emit('update:gizmoMode', $event)"
    />
    <TwinBindingPane
      v-else
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
