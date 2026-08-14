<script setup lang="ts">
/**
 * @fileoverview 左栏：模块库与图层树分页签。只做转发，动作判定全在页面层。
 */
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import type { GetModuleManifest } from '@dt/runtime'
import { DtSegmented } from '@dt/ui'
import { ref } from 'vue'

import type { EditorFrame } from '@/features/dashboard/editorLayout'
import LayerTree from './LayerTree.vue'
import ModuleLibrary from './ModuleLibrary.vue'

defineProps<{
  manifests: readonly ModuleManifest[]
  frames: readonly EditorFrame[]
  nodes: readonly DashboardNodePayload[]
  selectedIds: readonly string[]
  getManifest: GetModuleManifest
}>()

const emit = defineEmits<{
  add: [manifest: ModuleManifest]
  select: [nodeId: string, additive: boolean]
  toggle: [nodeId: string, isVisible: boolean]
  remove: [nodeId: string]
  rename: [nodeId: string, name: string]
  move: [nodeId: string, parentId: string | null, at?: number]
  center: [nodeId: string]
  front: [nodeId: string]
  back: [nodeId: string]
}>()

const TABS = [
  { value: 'library', label: '模块库' },
  { value: 'layers', label: '图层' },
]
const tab = ref('library')
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2">
    <DtSegmented v-model="tab" :options="TABS" size="sm" />
    <ModuleLibrary
      v-if="tab === 'library'"
      class="min-h-0 flex-1"
      :manifests="manifests"
      @add="emit('add', $event)"
    />
    <LayerTree
      v-else
      class="min-h-0 flex-1 overflow-y-auto"
      :frames="frames"
      :nodes="nodes"
      :selected-ids="selectedIds"
      :get-manifest="getManifest"
      @select="(nodeId, additive) => emit('select', nodeId, additive)"
      @toggle="(nodeId, isVisible) => emit('toggle', nodeId, isVisible)"
      @remove="emit('remove', $event)"
      @rename="(nodeId, name) => emit('rename', nodeId, name)"
      @move="(nodeId, parentId, at) => emit('move', nodeId, parentId, at)"
      @center="emit('center', $event)"
      @front="emit('front', $event)"
      @back="emit('back', $event)"
    />
  </div>
</template>
