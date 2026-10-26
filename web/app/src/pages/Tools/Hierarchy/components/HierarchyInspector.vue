<script setup lang="ts">
/** @fileoverview 层级图配置分区、节点定位与待应用修改。 */
import { computed, ref, watch } from 'vue'
import { DtButton, DtIcon, DtNotice, DtSegmented, DtSelect } from '@dt/ui'
import type { HierarchyEditor } from '../scripts/useHierarchyDocument'
import HierarchyNodeProperties from './HierarchyNodeProperties.vue'
import HierarchyRelations from './HierarchyRelations.vue'
import HierarchyPaperSettings from './HierarchyPaperSettings.vue'

const props = withDefaults(
  defineProps<{ editor: HierarchyEditor; readonly: boolean; mode?: string }>(),
  { mode: 'edit' },
)
const emit = defineEmits<{ focus: [id: string]; apply: [] }>()
const section = ref('node')
const sections = [
  { value: 'node', label: '节点属性' },
  { value: 'relations', label: '上下游' },
  { value: 'paper', label: '图纸设置' },
]
const options = computed(() =>
  (props.editor.document.value?.nodes ?? []).map((node) => ({
    value: node.id,
    label: `${node.code} · ${node.name}`,
  })),
)
const selected = computed(() => props.editor.selectedIds.value[0] ?? '')
const draftCount = computed(() => Object.keys(props.editor.drafts.value).length)
watch(
  () => props.mode,
  (mode) => {
    if (mode === 'drawing') section.value = 'paper'
  },
  { immediate: true },
)
watch(selected, (id) => {
  if (id && section.value === 'paper') section.value = 'node'
})
watch(
  () => props.editor.edgeId.value,
  (id) => {
    if (id && props.mode !== 'drawing') section.value = 'relations'
  },
  { immediate: true },
)
</script>

<template>
  <aside class="inspector" aria-label="层级图配置">
    <div class="flex shrink-0 items-center justify-between gap-2 px-4 pt-4">
      <h2 class="flex items-center gap-2 text-sm font-semibold">
        <DtIcon name="settings" :size="16" /> 配置面板
      </h2>
      <span class="text-xs text-text-secondary">{{
        readonly ? '只读' : '编辑配置'
      }}</span>
    </div>
    <div class="shrink-0 px-4 py-3">
      <DtSelect
        :model-value="selected"
        :options="options"
        label="查找节点"
        size="sm"
        :display="{ placeholder: '搜索编号或名称，定位节点', searchable: true }"
        @update:model-value="emit('focus', $event)"
      />
    </div>
    <DtSegmented
      v-model="section"
      :options="sections"
      variant="tabs"
      block
      aria-label="配置分区"
      class="shrink-0 px-3"
    />
    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <HierarchyNodeProperties
        v-if="section === 'node'"
        :editor="editor"
        :readonly="readonly"
      />
      <HierarchyRelations
        v-else-if="section === 'relations'"
        :editor="editor"
        :readonly="readonly"
        @focus="emit('focus', $event)"
      />
      <HierarchyPaperSettings v-else :editor="editor" :readonly="readonly" />
    </div>
    <div v-if="draftCount && !readonly" class="draft-actions">
      <DtNotice intent="warning">{{ draftCount }} 个节点有待应用修改</DtNotice>
      <div class="flex items-center gap-2">
        <DtButton class="flex-1" size="sm" @click="emit('apply')"
          >应用修改</DtButton
        >
        <DtButton size="sm" variant="ghost" @click="editor.discardDrafts()"
          >放弃修改</DtButton
        >
      </div>
      <p class="text-xs text-text-secondary">
        应用后自动保存；保存和导出也会应用修改。
      </p>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.inspector {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
  overflow: hidden;
}
.draft-actions {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-sunken);
}
</style>
