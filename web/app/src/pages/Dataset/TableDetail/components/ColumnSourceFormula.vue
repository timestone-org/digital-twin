<script setup lang="ts">
/**
 * @fileoverview 列表单里「公式计算」那一档的子块：挂公式编辑器。
 *
 * 公式只有一条落库路径——就是编辑器里那一行文本（docs/DATASET_DESIGN.md §6.2）。
 * 分段编辑面只是同一行文本的另一种改法，不是另一种存储。
 * ⚠ `validity` 一路上抛到弹窗：校验没过就不该放行保存，否则用户点完保存才在
 * 后端那里撞上一句「公式写不通」，而那时弹窗已经关了一半。
 */
import { DtNotice } from '@dt/ui'

import FormulaEditor from './FormulaEditor.vue'

const props = defineProps<{
  formulaError: string
  tableId: string
  /** 正在编辑的那一列的 key；给了后端才做环检测。 */
  columnKey: string
  /** 这一列的单位，试算结果跟着显示。 */
  unit: string
}>()

const emit = defineEmits<{ validity: [ok: boolean] }>()

const formula = defineModel<string>('formula', { required: true })
</script>

<template>
  <div class="flex flex-col gap-3">
    <FormulaEditor
      v-model:formula="formula"
      :table-id="props.tableId"
      :column-key="props.columnKey"
      :unit="props.unit"
      @validity="emit('validity', $event)"
    />
    <DtNotice v-if="props.formulaError" intent="danger">
      {{ props.formulaError }}
    </DtNotice>
  </div>
</template>
