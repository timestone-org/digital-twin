<script setup lang="ts">
/**
 * @fileoverview 右栏「属性 / 绑点」两页。图层树在左栏与模块库分页签，不在这里。
 * 它只做转发——所有改动都由页面统一交给 `editorActions`，
 * 这样「一次操作 = 一笔撤销」的判定只有一处。
 */
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import { DtSegmented } from '@dt/ui'
import { ref } from 'vue'

import type { BindingPayload } from '@dt/contracts'
import type { ConfigPath } from '@/features/dashboard/configPath'
import type { NodeGeometry } from '@/features/dashboard/editorDoc'
import BindingPanel from './BindingPanel.vue'
import PropertyPanel from './PropertyPanel.vue'

defineProps<{
  selected: DashboardNodePayload | null
  manifest: ModuleManifest | undefined
}>()

const emit = defineEmits<{
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
