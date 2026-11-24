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
    compact?: boolean
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
const editOptions = computed<DtMenuItem[]>(() => [
  {
    value: 'undo',
    label: '撤销',
    icon: 'undo',
    disabled: !props.editor.past.value.length,
  },
  {
    value: 'redo',
    label: '重做',
    icon: 'redo',
    disabled: !props.editor.future.value.length,
  },
  {
    value: 'arrange',
    label: '整理画布',
    icon: 'workflow',
    disabled: !document.value?.nodes.length,
  },
  ...alignOptions.value.map((item) => ({
    ...item,
    disabled: selectionCount.value < 2 || item.disabled === true,
  })),
  {
    value: 'remove',
    label: '删除选中',
    icon: 'trash',
    danger: true,
    disabled: !selectionCount.value && !props.editor.edgeId.value,
  },
])
function editAction(item: DtMenuItem) {
  if (props.busy || props.readonly || props.mode !== 'edit') return
  switch (item.value) {
    case 'undo':
      return props.editor.undo()
    case 'redo':
      return props.editor.undo(true)
    case 'arrange':
      return emit('arrange')
    case 'remove':
      return props.editor.remove()
    default:
      return align(item)
  }
}
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
  <section
    class="hierarchy-toolbar"
    :class="{ 'is-compact': compact }"
    aria-label="层级图工具栏"
  >
    <div class="workspace-heading">
      <div class="workspace-identity flex min-w-0 flex-1 items-center gap-3">
        <div v-if="!compact" class="project-symbol">
          <DtIcon name="network" :size="24" />
        </div>
        <div class="min-w-0">
          <h2 class="truncate text-base font-semibold" :title="document?.title">
            {{ document?.title }}
          </h2>
          <p class="mt-1 text-xs leading-relaxed text-text-secondary">
            <template v-if="compact"
              >计量 {{ meterCount }} · 汇流 {{ junctionCount }} · 连接
              {{ document?.edges.length ?? 0 }}</template
            >
            <template v-else
              >{{ meterCount }} 个计量节点 · {{ junctionCount }} 个汇流点 ·
              {{ document?.edges.length ?? 0 }} 条连接</template
            >
          </p>
        </div>
      </div>
      <div class="workspace-actions flex flex-wrap items-center gap-2">
        <span v-if="!compact" class="mode-label">
          {{ mode === 'edit' ? '关系编辑' : '标准图预览' }}
        </span>
        <DtButton
          v-if="mode === 'drawing' && !compact"
          size="sm"
          variant="outline"
          :disabled="busy"
          @click="emit('edit')"
        >
          返回编辑
        </DtButton>
        <!-- 只禁用不转圈：busy 也覆盖导出与加载项目，转圈会让人以为在出图 -->
        <DtButton size="sm" :disabled="busy" @click="emit('draw')">
          <template v-if="!compact" #leading
            ><DtIcon name="eye" :size="16"
          /></template>
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
              <template v-if="!compact" #leading
                ><DtIcon name="download" :size="16" /></template
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
      <div v-if="!compact" class="tool-group">
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
            variant="outline"
            draggable="true"
            :disabled="busy"
            title="组织公共连接，不占逻辑层级"
            @dragstart="drag($event, 'junction')"
            @click="emit('add', 'junction')"
          >
            <template #leading><DtIcon name="plus" :size="14" /></template>
            汇流点
          </DtButton>
        </div>
        <DtDropdownMenu
          v-if="compact"
          label="层级图编辑工具"
          :items="editOptions"
          :disabled="busy"
          @select="editAction"
        >
          <template #trigger="{ toggle, isOpen, panelId }">
            <DtButton
              size="sm"
              variant="ghost"
              aria-label="编辑工具"
              aria-haspopup="menu"
              :aria-expanded="isOpen"
              :aria-controls="panelId"
              :disabled="busy"
              @click="toggle"
            >
              编辑工具
              <template #trailing
                ><DtIcon name="chevron-down" :size="14"
              /></template>
            </DtButton>
          </template>
        </DtDropdownMenu>
        <div v-else class="tool-group">
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
        <div v-if="!compact" class="tool-group">
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
        <span
          v-if="selectionCount && !compact"
          class="text-xs text-accent-on-surface"
        >
          已选 {{ selectionCount }} 个节点
        </span>
      </template>
      <template v-else>
        <DtButton
          v-if="compact && mode === 'drawing'"
          size="sm"
          variant="outline"
          :disabled="busy"
          @click="emit('edit')"
        >
          返回编辑
        </DtButton>
        <span class="text-xs text-text-secondary">
          {{
            readonly
              ? '只读模式 · 可浏览关系、生成与导出图纸'
              : '可在配置面板调整图纸宽度'
          }}
        </span>
      </template>
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
.is-compact {
  --ctl-btn-px-sm: 8px;

  .workspace-heading {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    padding: 8px 10px;
  }
  .workspace-tools {
    gap: 4px;
    padding: 4px 8px;
  }
  .workspace-actions {
    gap: 4px;
  }
  .tool-group {
    padding-right: 4px;
  }
}
:global(.dt-menu[aria-label='层级图编辑工具']) {
  max-height: calc(50dvh - 48px);
  overflow-y: auto;
}
</style>
