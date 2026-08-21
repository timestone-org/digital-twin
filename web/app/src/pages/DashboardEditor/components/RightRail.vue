<script setup lang="ts">
/**
 * @fileoverview 右栏：按选中的个数在多选面板 / 属性面板 / 页面面板之间三选一。
 * ⚠ 三者互斥且**必须有一个在**：没选中节点时落到页面面板，而不是留一块空白栏。
 * ⚠ 模板属性里只放函数名，不写多行箭头——嵌套闸的正则会把模板里的 `=>` 算进层数。
 */
import type {
  BindingPayload,
  CardChrome,
  ConfigPreset,
  DashboardNodePayload,
  InteractionRule,
} from '@dt/contracts'
import type { GetModuleManifest } from '@dt/runtime'
import { computed } from 'vue'

import type { AlignKind } from '@/features/dashboard/canvasAlign'
import type {
  EditorGridConfig,
  SnapConfig,
} from '@/features/dashboard/canvasSnap'
import type { ConfigPath } from '@/features/dashboard/configPath'
import type { NodeGeometry } from '@/features/dashboard/editorDoc'
import type { SizeMatchMode } from '../scripts/editorArrange'
import type { OrderKind } from '../scripts/useEditorInspector'
import type { EditorMetaDraft } from '../scripts/useEditorMeta'
import ChromePanel from './ChromePanel.vue'
import InspectorPane from './InspectorPane.vue'
import MultiSelectPanel from './MultiSelectPanel.vue'

type MetaField = 'name' | 'description' | 'designWidth' | 'designHeight'

const props = defineProps<{
  selectedIds: readonly string[]
  selected: DashboardNodePayload | null
  nodes: readonly DashboardNodePayload[]
  getManifest: GetModuleManifest
  rules: readonly InteractionRule[]
  draft: EditorMetaDraft | null
  snap: SnapConfig
  grid: EditorGridConfig
  alignReady: boolean
  distributeReady: boolean
}>()

const emit = defineEmits<{
  align: [kind: AlignKind]
  distribute: [axis: 'x' | 'y']
  'remove-all': []
  config: [path: ConfigPath, value: unknown, isContinuous: boolean]
  geometry: [geometry: NodeGeometry, isContinuous: boolean]
  visible: [isVisible: boolean]
  rename: [name: string]
  order: [kind: OrderKind]
  preset: [preset: ConfigPreset]
  write: [binding: BindingPayload]
  drop: [fieldKey: string]
  bind: [fieldKey: string]
  pick: [fieldKey: string]
  addRow: [slotKey: string]
  removeRow: [slotKey: string, rowIndex: number]
  interactions: [rules: InteractionRule[]]
  'set-field': [key: MetaField, value: string | number | null]
  'set-snap': [patch: Partial<SnapConfig>]
  'set-grid': [patch: Partial<EditorGridConfig>]
  'set-card': [card: CardChrome]
  'select-type': [ids: readonly string[]]
  'size-batch': [mode: SizeMatchMode]
}>()

const count = computed(() => props.selectedIds.length)

/** 选中集的节点（文档序）；多选面板的清单与批量表单都吃它。 */
const selectedNodes = computed(() => {
  const wanted = new Set(props.selectedIds)
  return props.nodes.filter((node) => wanted.has(node.id))
})

function onDistribute(axis: 'x' | 'y'): void {
  emit('distribute', axis)
}

function onConfig(
  path: ConfigPath,
  value: unknown,
  isContinuous: boolean,
): void {
  emit('config', path, value, isContinuous)
}

function onGeometry(geometry: NodeGeometry, isContinuous: boolean): void {
  emit('geometry', geometry, isContinuous)
}

function onRemoveRow(slotKey: string, rowIndex: number): void {
  emit('removeRow', slotKey, rowIndex)
}

function onSetField(key: MetaField, value: string | number | null): void {
  emit('set-field', key, value)
}

function onSelectType(ids: readonly string[]): void {
  emit('select-type', ids)
}

// 批量显隐与单选的「初始可见」走同一个 visible 事件：页面侧本就写整个选中集
function onVisibleBatch(isVisible: boolean): void {
  emit('visible', isVisible)
}

function onSizeBatch(mode: SizeMatchMode): void {
  emit('size-batch', mode)
}

function onPreset(preset: ConfigPreset): void {
  emit('preset', preset)
}
</script>

<template>
  <section>
    <MultiSelectPanel
      v-if="count > 1"
      :selected-nodes="selectedNodes"
      :primary="selected"
      :get-manifest="getManifest"
      :align-ready="alignReady"
      :distribute-ready="distributeReady"
      @align="emit('align', $event)"
      @distribute="onDistribute"
      @remove-all="emit('remove-all')"
      @config="onConfig"
      @preset="onPreset"
      @select-type="onSelectType"
      @visible-batch="onVisibleBatch"
      @size-batch="onSizeBatch"
    />
    <InspectorPane
      v-else-if="count === 1"
      :selected="selected"
      :nodes="nodes"
      :get-manifest="getManifest"
      :rules="rules"
      @config="onConfig"
      @geometry="onGeometry"
      @visible="emit('visible', $event)"
      @rename="emit('rename', $event)"
      @order="emit('order', $event)"
      @preset="emit('preset', $event)"
      @interactions="emit('interactions', $event)"
      @write="emit('write', $event)"
      @drop="emit('drop', $event)"
      @bind="emit('bind', $event)"
      @pick="emit('pick', $event)"
      @add-row="emit('addRow', $event)"
      @remove-row="onRemoveRow"
    />
    <ChromePanel
      v-else
      :draft="draft"
      :snap="snap"
      :grid="grid"
      :nodes="nodes"
      :get-manifest="getManifest"
      @set-field="onSetField"
      @set-snap="emit('set-snap', $event)"
      @set-grid="emit('set-grid', $event)"
      @set-card="emit('set-card', $event)"
      @set-interactions="emit('interactions', $event)"
    />
  </section>
</template>
