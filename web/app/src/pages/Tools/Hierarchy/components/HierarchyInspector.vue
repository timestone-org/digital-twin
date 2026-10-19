<script setup lang="ts">
/** @fileoverview 节点属性、图纸设置和节点搜索定位。 */
import { computed, ref } from 'vue'
import {
  DtButton,
  DtInput,
  DtTextarea,
  DtNumberInput,
  DtSelect,
  DtNotice,
} from '@dt/ui'
import type { HierarchyEditor } from '../scripts/useHierarchyDocument'
import type { GraphDocument } from '../scripts/types'
const props = defineProps<{ editor: HierarchyEditor; readonly: boolean }>()
const emit = defineEmits<{ focus: [id: string]; apply: [] }>()
const query = ref('')
const node = computed(() => props.editor.editing.value)
const results = computed(() =>
  (props.editor.document.value?.nodes ?? [])
    .filter((item) =>
      `${item.code} ${item.name}`
        .toLowerCase()
        .includes(query.value.toLowerCase()),
    )
    .map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` })),
)
const selected = computed(() => props.editor.selectedIds.value[0] ?? '')
const relations = computed(() => {
  const document = props.editor.document.value,
    selected = node.value
  if (!document || !selected) return { parents: [], childCount: 0 }
  const parentIds = new Set(
    document.edges
      .filter((edge) => edge.target === selected.id)
      .map((edge) => edge.source),
  )
  return {
    parents: document.nodes.filter((parent) => parentIds.has(parent.id)),
    childCount: document.edges.filter((edge) => edge.source === selected.id)
      .length,
  }
})
const widths = [
  { value: '756', label: '窄幅 756 px' },
  { value: '1122', label: 'A3 横向 1122 px' },
  { value: '1516', label: '标准 1516 px' },
  { value: '2245', label: '宽幅 2245 px' },
  { value: '3200', label: '宽幅 3200 px' },
]
function paper(width: number | undefined) {
  const value = props.editor.document.value
  if (width !== undefined && value)
    props.editor.commit({ ...value, paper: { width: Math.round(width) } })
}
function title(value: string) {
  const current = props.editor.document.value
  if (current) props.editor.commit({ ...current, title: value })
}
const document = computed<GraphDocument | null>(
  () => props.editor.document.value,
)
</script>
<template>
  <aside
    class="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border-subtle pl-3"
  >
    <DtInput
      v-if="document"
      :model-value="document.title"
      label="项目名称"
      :disabled="readonly"
      :maxlength="80"
      @update:model-value="title"
    />
    <DtInput
      v-model="query"
      label="查找节点"
      type="search"
      placeholder="编号或名称"
    />
    <DtSelect
      :model-value="selected"
      :options="results"
      aria-label="定位节点"
      :display="{ placeholder: '选择节点定位', searchable: true }"
      @update:model-value="emit('focus', $event)"
    />
    <template v-if="node">
      <DtNotice>
        {{ node.kind === 'meter' ? '计量节点' : '汇流点：不占逻辑层级' }}
      </DtNotice>
      <DtInput
        :model-value="node.code"
        label="节点编号"
        :maxlength="40"
        :disabled="readonly"
        @update:model-value="editor.patchDraft({ code: $event })"
      />
      <DtTextarea
        :model-value="node.name"
        rows="3"
        hint="可手动换行，标准名称框最多两行"
        label="节点名称"
        :maxlength="100"
        :disabled="readonly"
        @update:model-value="editor.patchDraft({ name: $event })"
      />
      <DtInput
        v-if="node.kind === 'meter'"
        :model-value="node.parameter"
        label="圆内下栏"
        :maxlength="40"
        :disabled="readonly"
        @update:model-value="editor.patchDraft({ parameter: $event })"
      />
      <DtNumberInput
        :model-value="node.order"
        label="分支内顺序"
        :range="{ min: 0, max: 99999, step: 1 }"
        :disabled="readonly"
        @update:model-value="editor.patchDraft({ order: $event ?? 0 })"
      />
      <DtButton
        v-if="!readonly"
        :disabled="!editor.hasDrafts.value"
        @click="emit('apply')"
      >
        应用修改
      </DtButton>
      <p class="text-xs text-text-secondary">
        上级 {{ relations.parents.length }} · 下游 {{ relations.childCount }}
      </p>
      <div class="flex flex-wrap gap-1">
        <DtButton
          v-for="parent in relations.parents"
          :key="parent.id"
          variant="ghost"
          size="sm"
          @click="emit('focus', parent.id)"
          >{{ parent.code }}</DtButton
        >
      </div>
    </template>
    <template v-if="document">
      <DtSelect
        :model-value="String(document.paper.width)"
        :options="widths"
        label="常用图纸宽度"
        :disabled="readonly"
        @update:model-value="paper(Number($event))"
      />
      <DtNumberInput
        :model-value="document.paper.width"
        label="图纸宽度"
        unit="px"
        :range="{ min: 360, max: 12000, step: 1 }"
        :disabled="readonly"
        @update:model-value="paper"
      />
    </template>
    <p class="text-xs text-text-secondary">
      高度自动延伸。标准图按真实关系计算层级，编辑坐标与缩放不影响出图。名称最多两行；超限时会定位提示。
    </p>
  </aside>
</template>
