<script setup lang="ts">
/** @fileoverview 层级图编辑、对齐与格式导出工具栏。 */
import { ref } from 'vue'
import { DtButton, DtSelect } from '@dt/ui'
import type { HierarchyEditor } from '../scripts/useHierarchyDocument'
import type { Alignment } from '../scripts/geometry'
import type { ExportFormat, NodeKind } from '../scripts/types'
const props = defineProps<{
  editor: HierarchyEditor
  readonly: boolean
  busy: boolean
  mode: string
}>()
const emit = defineEmits<{
  projects: []
  inspector: []
  add: [kind: NodeKind]
  arrange: []
  draw: []
  edit: []
  export: [format: ExportFormat]
}>()
const alignment = ref('left'),
  format = ref('svg')
const alignOptions = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '水平居中' },
  { value: 'right', label: '右对齐' },
  { value: 'top', label: '顶对齐' },
  { value: 'middle', label: '垂直居中' },
  { value: 'bottom', label: '底对齐' },
  { value: 'horizontal', label: '水平等距' },
  { value: 'vertical', label: '垂直等距' },
]
const formats = [
  { value: 'svg', label: 'SVG 矢量图' },
  { value: 'png', label: 'PNG 高清图' },
  { value: 'pdf', label: 'PDF 矢量打印' },
  { value: 'json', label: 'JSON 配置' },
  { value: 'xlsx', label: 'Excel 配置' },
]
function align() {
  const value = alignment.value
  if (isAlignment(value)) props.editor.align(value)
}
function isAlignment(value: string): value is Alignment {
  return [
    'left',
    'center',
    'right',
    'top',
    'middle',
    'bottom',
    'horizontal',
    'vertical',
  ].includes(value)
}
function exportFile() {
  const value = format.value
  if (
    value === 'svg' ||
    value === 'png' ||
    value === 'pdf' ||
    value === 'json' ||
    value === 'xlsx'
  )
    emit('export', value)
}
function drag(event: DragEvent, kind: NodeKind) {
  event.dataTransfer?.setData('application/hierarchy-node', kind)
}
</script>
<template>
  <div class="flex shrink-0 items-center gap-2 overflow-x-auto pb-3">
    <DtButton size="sm" variant="ghost" @click="emit('projects')"
      >项目列表</DtButton
    >
    <DtButton
      v-if="mode === 'edit'"
      size="sm"
      variant="ghost"
      @click="emit('inspector')"
      >属性</DtButton
    >
    <template v-if="!readonly && mode === 'edit'">
      <DtButton
        size="sm"
        variant="outline"
        draggable="true"
        :disabled="busy"
        @dragstart="drag($event, 'meter')"
        @click="emit('add', 'meter')"
      >
        计量节点
      </DtButton>
      <DtButton
        size="sm"
        variant="outline"
        draggable="true"
        :disabled="busy"
        @dragstart="drag($event, 'junction')"
        @click="emit('add', 'junction')"
      >
        汇流点
      </DtButton>
      <DtButton
        size="sm"
        variant="ghost"
        :disabled="busy || !editor.past.value.length"
        @click="editor.undo()"
      >
        撤销
      </DtButton>
      <DtButton
        size="sm"
        variant="ghost"
        :disabled="busy || !editor.future.value.length"
        @click="editor.undo(true)"
      >
        重做
      </DtButton>
      <DtButton
        size="sm"
        variant="ghost"
        :disabled="
          busy || (!editor.selectedIds.value.length && !editor.edgeId.value)
        "
        @click="editor.remove"
      >
        删除选中
      </DtButton>
      <DtButton
        size="sm"
        variant="outline"
        :disabled="busy"
        @click="emit('arrange')"
      >
        整理画布
      </DtButton>
      <DtSelect
        v-model="alignment"
        :options="alignOptions"
        aria-label="对齐方式"
        size="sm"
        class="w-28 shrink-0"
      />
      <DtButton
        size="sm"
        variant="ghost"
        :disabled="busy || editor.selectedIds.value.length < 2"
        @click="align"
      >
        应用对齐
      </DtButton>
    </template>
    <DtButton
      v-if="mode === 'drawing'"
      size="sm"
      variant="outline"
      @click="emit('edit')"
    >
      返回编辑
    </DtButton>
    <DtButton size="sm" :disabled="busy" @click="emit('draw')">
      生成层级图
    </DtButton>
    <DtSelect
      v-model="format"
      :options="formats"
      aria-label="导出格式"
      size="sm"
      class="w-36 shrink-0"
    />
    <DtButton size="sm" variant="outline" :disabled="busy" @click="exportFile">
      导出
    </DtButton>
  </div>
</template>
