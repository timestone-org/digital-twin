<script setup lang="ts">
/** @fileoverview 项目概览、画布编辑与图纸导出的分组工具栏。 */
import { computed } from 'vue'
import {
  DtButton,
  DtDropdownMenu,
  DtIcon,
  DtIconButton,
  DtPopover,
} from '@dt/ui'
import type { DtMenuItem } from '@dt/contracts'
import type { HierarchyEditor } from '../scripts/useHierarchyDocument'
import type { Alignment } from '../scripts/geometry'
import type { ExportFormat, NodeKind } from '../scripts/types'

const props = withDefaults(
  defineProps<{
    editor: HierarchyEditor
    readonly: boolean
    busy: boolean
    mode: string
    panels?: { projects: boolean; inspector: boolean }
  }>(),
  { panels: () => ({ projects: true, inspector: true }) },
)
const emit = defineEmits<{
  projects: []
  inspector: []
  add: [kind: NodeKind]
  arrange: []
  draw: []
  edit: []
  export: [format: ExportFormat]
}>()
const document = computed(() => props.editor.document.value)
const meterCount = computed(
  () =>
    document.value?.nodes.filter((node) => node.kind === 'meter').length ?? 0,
)
const junctionCount = computed(
  () =>
    document.value?.nodes.filter((node) => node.kind === 'junction').length ??
    0,
)
const selectionCount = computed(() => props.editor.selectedIds.value.length)
const alignOptions = computed<DtMenuItem[]>(() => [
  { value: 'left', label: '左对齐', icon: 'align-left' },
  { value: 'center', label: '水平居中', icon: 'align-center-horizontal' },
  { value: 'right', label: '右对齐', icon: 'align-right' },
  { value: 'top', label: '顶对齐', icon: 'align-top' },
  { value: 'middle', label: '垂直居中', icon: 'align-center-vertical' },
  { value: 'bottom', label: '底对齐', icon: 'align-bottom' },
  {
    value: 'horizontal',
    label: '水平等距',
    icon: 'distribute-horizontal',
    disabled: selectionCount.value < 3,
  },
  {
    value: 'vertical',
    label: '垂直等距',
    icon: 'distribute-vertical',
    disabled: selectionCount.value < 3,
  },
])
const formats = [
  { value: 'svg', label: 'SVG · 可编辑矢量图', icon: 'image' },
  { value: 'png', label: 'PNG · 高清图片', icon: 'image' },
  { value: 'pdf', label: 'PDF · 矢量打印', icon: 'ruler' },
  { value: 'json', label: 'JSON · 完整项目配置', icon: 'folder' },
  { value: 'xlsx', label: 'Excel · 批量编辑配置', icon: 'table' },
]
function align(item: DtMenuItem) {
  if (isAlignment(item.value)) props.editor.align(item.value)
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
function exportFile(item: DtMenuItem) {
  const value = item.value
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
  if (!props.busy)
    event.dataTransfer?.setData('application/hierarchy-node', kind)
}
</script>

<template>
  <section class="hierarchy-toolbar" aria-label="层级图工具栏">
    <div class="workspace-heading">
      <div class="workspace-identity flex min-w-0 flex-1 items-center gap-3">
        <div class="project-symbol"><DtIcon name="network" :size="24" /></div>
        <div class="min-w-0">
          <h2 class="truncate text-base font-semibold" :title="document?.title">
            {{ document?.title }}
          </h2>
          <p class="mt-1 text-xs leading-relaxed text-text-secondary">
            {{ meterCount }} 个计量节点 · {{ junctionCount }} 个汇流点 ·
            {{ document?.edges.length ?? 0 }} 条连接
          </p>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="mode-label">
          {{ mode === 'edit' ? '关系编辑' : '标准图预览' }}
        </span>
        <DtButton
          v-if="mode === 'drawing'"
          size="sm"
          variant="outline"
          :disabled="busy"
          @click="emit('edit')"
        >
          返回编辑
        </DtButton>
        <DtButton
          size="sm"
          :disabled="busy"
          :loading="busy"
          @click="emit('draw')"
        >
          <template #leading><DtIcon name="eye" :size="16" /></template>
          {{ mode === 'drawing' ? '重新生成' : '生成层级图' }}
        </DtButton>
        <DtDropdownMenu
          label="导出层级图"
          :items="formats"
          :disabled="busy"
          @select="exportFile"
        >
          <template #trigger="{ toggle, isOpen }">
            <DtButton
              size="sm"
              variant="outline"
              :disabled="busy"
              :aria-expanded="isOpen"
              aria-haspopup="menu"
              @click="toggle"
            >
              <template #leading><DtIcon name="download" :size="16" /></template
              >导出
              <template #trailing
                ><DtIcon name="chevron-down" :size="14"
              /></template>
            </DtButton>
          </template>
        </DtDropdownMenu>
      </div>
    </div>
    <div class="workspace-tools">
      <div class="tool-group">
        <DtIconButton
          icon="folder"
          label="项目列表"
          :pressed="props.panels.projects"
          @click="emit('projects')"
        />
        <DtIconButton
          icon="settings"
          label="配置面板"
          :pressed="props.panels.inspector"
          @click="emit('inspector')"
        />
      </div>
      <template v-if="!readonly && mode === 'edit'">
        <div class="tool-group">
          <DtButton
            size="sm"
            variant="outline"
            draggable="true"
            :disabled="busy"
            title="点击添加，或拖入画布"
            @dragstart="drag($event, 'meter')"
            @click="emit('add', 'meter')"
          >
            <template #leading><DtIcon name="plus" :size="14" /></template>
            计量节点
          </DtButton>
          <DtButton
            size="sm"
            variant="ghost"
            draggable="true"
            :disabled="busy"
            title="组织公共连接，不占逻辑层级"
            @dragstart="drag($event, 'junction')"
            @click="emit('add', 'junction')"
          >
            汇流点
          </DtButton>
        </div>
        <div class="tool-group">
          <DtIconButton
            :disabled="busy || !editor.past.value.length"
            icon="undo"
            label="撤销"
            tooltip="撤销 · Ctrl / ⌘ Z"
            @click="editor.undo()"
          />
          <DtIconButton
            :disabled="busy || !editor.future.value.length"
            icon="redo"
            label="重做"
            tooltip="重做 · Ctrl / ⌘ Shift Z"
            @click="editor.undo(true)"
          />
          <DtIconButton
            :disabled="busy || (!selectionCount && !editor.edgeId.value)"
            intent="danger"
            icon="trash"
            label="删除选中"
            @click="editor.remove"
          />
        </div>
        <div class="tool-group">
          <DtButton
            size="sm"
            variant="ghost"
            :disabled="busy || !document?.nodes.length"
            @click="emit('arrange')"
          >
            <template #leading><DtIcon name="workflow" :size="14" /></template>
            整理画布
          </DtButton>
          <DtDropdownMenu
            label="对齐与分布"
            :items="alignOptions"
            :disabled="busy || selectionCount < 2"
            @select="align"
          >
            <template #trigger="{ toggle, isOpen }">
              <DtButton
                size="sm"
                variant="ghost"
                :disabled="busy || selectionCount < 2"
                :aria-expanded="isOpen"
                aria-haspopup="menu"
                title="选择至少 2 个节点进行对齐；等距分布需 3 个"
                @click="toggle"
              >
                对齐与分布
              </DtButton>
            </template>
          </DtDropdownMenu>
        </div>
        <span v-if="selectionCount" class="text-xs text-accent-on-surface">
          已选 {{ selectionCount }} 个节点
        </span>
      </template>
      <span v-else class="text-xs text-text-secondary">
        {{
          readonly
            ? '只读模式 · 可浏览关系、生成与导出图纸'
            : '标准图按连接关系自动排版，可在右侧调整图纸宽度'
        }}
      </span>
      <DtPopover align="end" panel-label="层级图操作指南" class="ml-auto">
        <template #default="{ toggle, isOpen }">
          <DtIconButton
            icon="circle-question"
            label="操作指南"
            :pressed="isOpen"
            @click="toggle"
          />
        </template>
        <template #content>
          <div class="flex flex-col gap-3 p-1 text-xs leading-relaxed">
            <strong class="text-sm">快速上手</strong>
            <p>1. 添加计量节点，在配置面板填写编号和名称。</p>
            <p>2. 从输出端口连向输入端口，或在“上下游”中搜索建立连接。</p>
            <p>3. 设置图纸宽度，生成预览后导出图片或配置。</p>
            <div class="border-t border-border-subtle pt-2 text-text-secondary">
              <p>Shift + 单击 / 拖动：多选 / 框选</p>
              <p>拖动画布空白处：平移 · 滚轮：缩放</p>
              <p>方向键：微调 · Shift + 方向键：移动 10 px</p>
              <p>Ctrl / ⌘ S：保存 · Ctrl / ⌘ Z：撤销</p>
              <p>Delete：删除选中 · Esc：取消连线</p>
            </div>
          </div>
        </template>
      </DtPopover>
    </div>
  </section>
</template>

<style scoped lang="scss">
.hierarchy-toolbar {
  flex-shrink: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
}
.workspace-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 16px;
}
.project-symbol {
  display: grid;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  place-items: center;
  border-radius: var(--radius-md);
  background: rgba(var(--accent-primary-rgb), 0.1);
  color: var(--accent-on-surface);
}
.mode-label {
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  font-size: 12px;
  color: var(--text-secondary);
}
.workspace-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border-subtle);
}
.tool-group {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 8px;
  border-right: 1px solid var(--border-subtle);
}
@media (max-width: 640px) {
  .workspace-tools > .tool-group:first-child {
    display: none;
  }
  .workspace-identity {
    flex-basis: 100%;
  }
  .mode-label {
    display: none;
  }
  .workspace-heading {
    gap: 12px;
    padding: 12px;
  }
}
</style>
