<script setup lang="ts">
/**
 * @fileoverview 右栏选中单个节点时的四页：通用 / 专属 / 绑定 / 联动。
 * 页签按模块能力增减——没有 `configSchema` 就没有「专属」，没有 `bindings` 就没有
 * 「绑定」，摆一个点不进去的空页签比少一个页签更让人以为是坏了。
 * 它只做转发——所有改动都由页面统一交给 `editorActions`，
 * 这样「一次操作 = 一笔撤销」的判定只有一处。
 */
import type {
  BindingPayload,
  ConfigPreset,
  DashboardNodePayload,
  InteractionRule,
  ModuleManifest,
} from '@dt/contracts'
import type { GetModuleManifest } from '@dt/runtime'
import { DtEmpty, DtSegmented } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import type { ConfigPath } from '@/features/dashboard/configPath'
import type { OrderKind } from '../useEditorInspector'
import {
  layerPositionOf,
  type NodeGeometry,
} from '@/features/dashboard/editorDoc'
import BindingPanel from './BindingPanel.vue'
import InteractionEditor from './InteractionEditor.vue'
import NodeCommonPanel from './NodeCommonPanel.vue'
import PropertyPanel from './PropertyPanel.vue'

const props = defineProps<{
  selected: DashboardNodePayload | null
  nodes: readonly DashboardNodePayload[]
  getManifest: GetModuleManifest
  rules: readonly InteractionRule[]
}>()

const manifest = computed<ModuleManifest | undefined>(() =>
  props.selected === null
    ? undefined
    : props.getManifest(props.selected.moduleType),
)

/** 选中节点在同层里的层序；没选中时为 null。 */
const layer = computed(() =>
  props.selected === null
    ? null
    : layerPositionOf(props.nodes, props.selected.id),
)

const emit = defineEmits<{
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
}>()

type TabKey = 'common' | 'config' | 'binding' | 'interaction'

const hasOwnConfig = computed(() => {
  const found = manifest.value
  if (found === undefined) return false
  return found.configSchema.length > 0 || (found.configPresets ?? []).length > 0
})

const hasBindings = computed(() => (manifest.value?.bindings ?? []).length > 0)

/** 页签表。通用与联动恒在：任何节点都能被联动显隐，也都有几何与外观。 */
const tabs = computed(() => {
  const items: { value: TabKey; label: string }[] = [
    { value: 'common', label: '通用' },
  ]
  if (hasOwnConfig.value) items.push({ value: 'config', label: '专属' })
  if (hasBindings.value) items.push({ value: 'binding', label: '绑定' })
  items.push({ value: 'interaction', label: '联动' })
  return items
})

const tab = ref<TabKey>('common')

/** 换成一个没有专属配置的模块时，停在已消失的页签上会看到一片空白。 */
watch(tabs, (next) => {
  if (!next.some((item) => item.value === tab.value)) tab.value = 'common'
})

function onTab(value: string): void {
  if (
    value === 'common' ||
    value === 'config' ||
    value === 'binding' ||
    value === 'interaction'
  ) {
    tab.value = value
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <DtEmpty
      v-if="selected === null"
      icon="layout-grid"
      title="没有选中节点"
      hint="在画布或图层树上点一个节点"
    />
    <template v-else>
      <DtSegmented
        :model-value="tab"
        :options="tabs"
        size="sm"
        block
        variant="tabs"
        aria-label="属性面板分页"
        @update:model-value="onTab"
      />

      <NodeCommonPanel
        v-if="tab === 'common'"
        :node="selected"
        :manifest="manifest"
        :layer="layer"
        @config="(path, value, live) => emit('config', path, value, live)"
        @geometry="(geometry, live) => emit('geometry', geometry, live)"
        @visible="emit('visible', $event)"
        @rename="emit('rename', $event)"
        @order="emit('order', $event)"
      />
      <PropertyPanel
        v-else-if="tab === 'config'"
        :node="selected"
        :manifest="manifest"
        @config="(path, value, live) => emit('config', path, value, live)"
        @preset="emit('preset', $event)"
      />
      <BindingPanel
        v-else-if="tab === 'binding'"
        :node="selected"
        :manifest="manifest"
        @write="emit('write', $event)"
        @drop="emit('drop', $event)"
        @bind="emit('bind', $event)"
        @pick="emit('pick', $event)"
        @add-row="emit('addRow', $event)"
        @remove-row="
          (slotKey, rowIndex) => emit('removeRow', slotKey, rowIndex)
        "
      />
      <InteractionEditor
        v-else
        class="min-h-0 flex-1 overflow-y-auto pr-1"
        :rules="rules"
        :nodes="nodes"
        :get-manifest="getManifest"
        :focus-node-id="selected.id"
        @update:rules="emit('interactions', $event)"
      />
    </template>
  </div>
</template>
