<script setup lang="ts">
/**
 * @fileoverview 右栏：图层树 + 「属性 / 绑点」两页。
 * 它只做转发——所有改动都由页面统一交给 `editorActions`，
 * 这样「一次操作 = 一笔撤销」的判定只有一处。
 */
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import type { GetModuleManifest } from '@dt/runtime'
import { DtSegmented } from '@dt/ui'
import { ref } from 'vue'

import type { BindingPayload } from '@dt/contracts'
import type { ConfigPath } from '@/features/dashboard/configPath'
import type { NodeGeometry } from '@/features/dashboard/editorDoc'
import BindingPanel from './BindingPanel.vue'
import LayerTree from './LayerTree.vue'
import PropertyPanel from './PropertyPanel.vue'

defineProps<{
  nodes: readonly DashboardNodePayload[]
  selectedId: string | null
  selected: DashboardNodePayload | null
  manifest: ModuleManifest | undefined
  getManifest: GetModuleManifest
}>()

const emit = defineEmits<{
  select: [nodeId: string | null]
  toggle: [nodeId: string, isVisible: boolean]
  remove: [nodeId: string]
  config: [path: ConfigPath, value: unknown, isContinuous: boolean]
  geometry: [geometry: NodeGeometry, isContinuous: boolean]
  visible: [isVisible: boolean]
  write: [binding: BindingPayload]
  drop: [fieldKey: string]
  bind: [fieldKey: string]
  pick: [fieldKey: string]
  addRow: [slotKey: string]
  removeRow: [slotKey: string, rowIndex: number]
}>()

const TABS = [
  { value: 'config', label: '属性' },
  { value: 'binding', label: '绑点' },
]

const tab = ref('config')
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <div class="max-h-48 min-h-0 overflow-y-auto">
      <LayerTree
        :nodes="nodes"
        :parent-id="null"
        :selected-id="selectedId"
        :get-manifest="getManifest"
        @select="emit('select', $event)"
        @toggle="(id, visible) => emit('toggle', id, visible)"
        @remove="emit('remove', $event)"
      />
    </div>

    <DtSegmented v-model="tab" :options="TABS" size="sm" />

    <PropertyPanel
      v-if="tab === 'config'"
      :node="selected"
      :manifest="manifest"
      @config="(path, value, live) => emit('config', path, value, live)"
      @geometry="(geometry, live) => emit('geometry', geometry, live)"
      @visible="emit('visible', $event)"
    />
    <BindingPanel
      v-else
      :node="selected"
      :manifest="manifest"
      @write="emit('write', $event)"
      @drop="emit('drop', $event)"
      @bind="emit('bind', $event)"
      @pick="emit('pick', $event)"
      @add-row="emit('addRow', $event)"
      @remove-row="(slotKey, rowIndex) => emit('removeRow', slotKey, rowIndex)"
    />
  </div>
</template>
