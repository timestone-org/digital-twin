<script setup lang="ts">
/** @fileoverview 单节点属性编辑及多选、未选择状态。 */
import { computed } from 'vue'
import {
  DtEmpty,
  DtIcon,
  DtInput,
  DtNotice,
  DtNumberInput,
  DtTextarea,
} from '@dt/ui'
import type { HierarchyEditor } from '../scripts/useHierarchyDocument'

const props = defineProps<{ editor: HierarchyEditor; readonly: boolean }>()
const node = computed(() => props.editor.editing.value)
const count = computed(() => props.editor.selectedIds.value.length)
const codeError = computed(() => {
  const current = node.value
  if (!current) return ''
  if (!current.code.trim()) return '请填写节点编号'
  const duplicate = props.editor.document.value?.nodes.some(
    (item) =>
      item.id !== current.id &&
      (props.editor.drafts.value[item.id]?.code ?? item.code).trim() ===
        current.code.trim(),
  )
  return duplicate ? '此编号已被其他节点使用' : ''
})
const nameError = computed(() =>
  node.value && !node.value.name.trim() ? '请填写节点名称' : '',
)
</script>

<template>
  <div v-if="count > 1" class="flex flex-col gap-4">
    <DtNotice>已选择 {{ count }} 个节点</DtNotice>
    <p class="text-sm leading-relaxed text-text-secondary">
      使用画布上方的对齐工具统一排列，或拖动任一选中节点整体移动。
    </p>
    <p class="text-xs text-text-secondary">
      单击一个节点可编辑它的编号、名称和参数。
    </p>
  </div>
  <div v-else-if="node" class="flex flex-col gap-4">
    <div class="node-summary">
      <DtIcon :name="node.kind === 'meter' ? 'gauge' : 'network'" :size="22" />
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm font-semibold" :title="node.code">
          {{ node.code }}
        </h3>
        <p class="mt-1 text-xs text-text-secondary">
          {{ node.kind === 'meter' ? '计量节点' : '汇流点 · 不占逻辑层级' }}
        </p>
      </div>
    </div>
    <DtInput
      :model-value="node.code"
      label="节点编号"
      :error="codeError"
      hint="项目内唯一，用于图纸标识与查找"
      :maxlength="40"
      :disabled="readonly"
      @update:model-value="editor.patchDraft({ code: $event })"
    />
    <DtTextarea
      :model-value="node.name"
      rows="3"
      hint="支持手动换行；标准图名称最多显示两行"
      label="节点名称"
      :error="nameError"
      :maxlength="100"
      :disabled="readonly"
      @update:model-value="editor.patchDraft({ name: $event })"
    />
    <DtInput
      v-if="node.kind === 'meter'"
      :model-value="node.parameter"
      label="圆内下栏"
      placeholder="例如：1.0级"
      hint="显示在计量圆内的下半部分"
      :maxlength="40"
      :disabled="readonly"
      @update:model-value="editor.patchDraft({ parameter: $event })"
    />
    <DtNumberInput
      :model-value="node.order"
      label="分支内顺序"
      hint="数值越小，同一分支内越靠前"
      :range="{ min: 0, max: 99999, step: 1 }"
      :disabled="readonly"
      @update:model-value="editor.patchDraft({ order: $event ?? 0 })"
    />
  </div>
  <DtEmpty
    v-else
    icon="square-mouse-pointer"
    title="选择节点，开始配置"
    hint="点击画布中的节点，或在上方搜索定位。Shift 可多选节点。"
  />
</template>

<style scoped lang="scss">
.node-summary {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 14px;
  color: var(--accent-on-surface);
  background: rgba(var(--accent-primary-rgb), 0.07);
  border: 1px solid rgba(var(--accent-primary-rgb), 0.2);
  border-radius: var(--radius-md);
}
</style>
