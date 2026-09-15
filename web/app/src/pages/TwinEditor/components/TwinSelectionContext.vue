<script setup lang="ts">
/** @fileoverview 当前对象与关联对象的固定导航入口。 */
import type { TwinConfig } from '@dt/twin-config'
import type { ModelAnimationEntry } from '@dt/three-core'
import { DtSelect } from '@dt/ui'
import { computed } from 'vue'
import type { TwinSelection } from '../scripts/types'
import { relatedObjects, selectedObjectLabel } from '../scripts/relatedObjects'
const props = defineProps<{
  config: TwinConfig
  selection: TwinSelection
  clips: readonly ModelAnimationEntry[]
  animation: string | null
}>()
const emit = defineEmits<{
  select: [TwinSelection]
  selectAnimation: [string]
}>()
const title = computed(() =>
  selectedObjectLabel(props.config, props.selection, props.animation),
)
const links = computed(() =>
  relatedObjects(props.config, props.selection, props.clips, props.animation),
)
const options = computed(() => [
  { value: '', label: `关联对象 · ${links.value.length}` },
  ...links.value,
])
function navigate(value: string): void {
  const link = links.value.find((link) => link.value === value)
  if (link?.selection) emit('select', link.selection)
  if (link?.animation) emit('selectAnimation', link.animation)
}
</script>
<template>
  <div
    class="flex shrink-0 flex-col gap-1 border-b border-border-subtle p-2"
    data-test="selection-context"
  >
    <strong class="truncate text-xs" :title="title">{{ title }}</strong>
    <DtSelect
      v-if="links.length"
      model-value=""
      :options="options"
      size="sm"
      aria-label="跳转关联对象"
      @update:model-value="navigate"
    />
  </div>
</template>
