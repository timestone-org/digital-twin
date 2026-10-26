<script setup lang="ts">
/** @fileoverview 项目名称、图纸幅宽预设与自定义幅宽。 */
import { computed } from 'vue'
import { DtIcon, DtInput, DtNumberInput, DtSelect } from '@dt/ui'
import type { HierarchyEditor } from '../scripts/useHierarchyDocument'

const props = defineProps<{ editor: HierarchyEditor; readonly: boolean }>()
const document = computed(() => props.editor.document.value)
const widths = [
  { value: '756', label: '窄幅 · 756 px' },
  { value: '1122', label: 'A3 横向 · 1122 px' },
  { value: '1516', label: '标准幅宽 · 1516 px' },
  { value: '2245', label: '宽幅 · 2245 px' },
  { value: '3200', label: '超宽幅 · 3200 px' },
]
const preset = computed(() => {
  const width = String(document.value?.paper.width)
  return widths.some((option) => option.value === width) ? width : ''
})
function paper(width: number | undefined) {
  const value = document.value
  if (width !== undefined && Number.isFinite(width) && value)
    props.editor.commit({
      ...value,
      paper: { width: Math.max(360, Math.min(12000, Math.round(width))) },
    })
}
function title(value: string) {
  const current = document.value
  if (current) props.editor.commit({ ...current, title: value })
}
</script>

<template>
  <div v-if="document" class="flex flex-col gap-5">
    <DtInput
      :model-value="document.title"
      label="项目名称"
      :error="document.title.trim() ? '' : '请填写项目名称后保存'"
      :disabled="readonly"
      :maxlength="80"
      @update:model-value="title"
    />
    <div class="paper-summary">
      <DtIcon name="ruler" :size="24" />
      <strong class="text-base">{{ document.paper.width }} px</strong>
      <span class="text-xs text-text-secondary">图纸宽度 · 高度自动延伸</span>
    </div>
    <DtSelect
      :model-value="preset"
      :options="widths"
      label="常用图纸宽度"
      :display="{ placeholder: '自定义宽度' }"
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
    <div
      class="rounded-md bg-surface-sunken p-3 text-xs leading-relaxed text-text-secondary"
    >
      <p class="mb-2 font-medium text-text-primary">出图规则</p>
      <p>
        层级按上下游关系自动计算，宽度不足时自动折行。画布位置与缩放不影响标准图。
      </p>
      <p class="mt-2">调整后点击“生成层级图”查看效果；导出始终采用当前配置。</p>
    </div>
  </div>
</template>

<style scoped lang="scss">
.paper-summary {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 22px 12px;
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  color: var(--accent-on-surface);
}
</style>
