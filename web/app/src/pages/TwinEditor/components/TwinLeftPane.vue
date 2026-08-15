<script setup lang="ts">
/**
 * @fileoverview 左栏的两个页签：「大纲」按文档序平铺场上的一切，「层级」画钻取树。
 *
 * ⚠ 两栏各画各的次序，合成一栏必然打架：大纲行上的序号**就是**数组绑定的对齐
 * 位次，而钻取树上拖一下改的是父子与同级次序、绝不动文档序。摆在一起会让人
 * 以为拖树也会改绑定行。
 */
import type { TwinConfig } from '@dt/twin-config'
import { DtSegmented } from '@dt/ui'
import { ref } from 'vue'

import type { TwinEntityKind, TwinSelection } from '../types'
import TwinHierarchyPanel from './TwinHierarchyPanel.vue'
import TwinOutline from './TwinOutline.vue'

defineProps<{
  config: TwinConfig
  selection: TwinSelection | null
  /** 有诊断问题的实体 id 集合，两栏都拿它打红点。 */
  flaggedIds: ReadonlySet<string>
}>()

const emit = defineEmits<{
  select: [TwinSelection]
  add: [TwinEntityKind]
  bulkAdd: []
  remove: [{ kind: TwinEntityKind; id: string }]
  duplicate: [{ kind: TwinEntityKind; id: string }]
  move: [{ kind: TwinEntityKind; id: string; delta: number }]
  toggleVisible: [{ kind: TwinEntityKind; id: string }]
  addHier: [string | null]
  moveHier: [{ id: string; delta: number }]
  reparentHier: [{ id: string; parentId: string | null }]
}>()

const TABS = [
  { value: 'outline', label: '大纲' },
  { value: 'hier', label: '层级' },
] as const

const tab = ref<'outline' | 'hier'>('outline')

function switchTab(next: string): void {
  tab.value = next === 'hier' ? 'hier' : 'outline'
}

function removeHier(id: string): void {
  emit('remove', { kind: 'hierNodes', id })
}
</script>

<template>
  <div class="flex min-h-0 flex-col" data-test="twin-left-pane">
    <DtSegmented
      class="shrink-0 p-1"
      :model-value="tab"
      :options="TABS"
      aria-label="左栏页签"
      size="sm"
      block
      @update:model-value="switchTab"
    />
    <div class="min-h-0 flex-1 overflow-y-auto">
      <TwinOutline
        v-if="tab === 'outline'"
        :config="config"
        :selection="selection"
        :flagged-ids="flaggedIds"
        @select="emit('select', $event)"
        @add="emit('add', $event)"
        @bulk-add="emit('bulkAdd')"
        @remove="emit('remove', $event)"
        @duplicate="emit('duplicate', $event)"
        @move="emit('move', $event)"
        @toggle-visible="emit('toggleVisible', $event)"
      />
      <TwinHierarchyPanel
        v-else
        :config="config"
        :selection="selection"
        :flagged-ids="flaggedIds"
        @select="emit('select', $event)"
        @add="emit('addHier', $event)"
        @remove="removeHier"
        @move="emit('moveHier', $event)"
        @reparent="emit('reparentHier', $event)"
      />
    </div>
  </div>
</template>
