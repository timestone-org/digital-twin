<script setup lang="ts">
/**
 * @fileoverview 校验结论那一条：可用 / 有误的灯、后端说的错误、以及读法
 * （记号树优先画成二维数学式，画不出来时退回一行文本）。
 *
 * ⚠ 这四种表现是**互斥**的一档一档：正在校验时既不该显示旧的错误，也不该显示
 * 旧的读法。「改完了还亮着绿灯」是最骗人的一种状态（docs/DATASET_DESIGN.md §7.6）。
 * ⚠ 校验请求打不通与公式写错分开说：前者是「不知道对不对」，说成「公式有误」
 * 会让人去改一条根本没问题的公式。
 */
import { DtIcon, DtSpinner, DtTag } from '@dt/ui'

import FormulaNotation from './FormulaNotation.vue'
import type { FormulaCheckStatus } from '../scripts/useFormulaValidation'

const props = defineProps<{
  status: FormulaCheckStatus
  /** 后端说的公式错误。 */
  error: string
  /** 校验请求本身失败的原因。 */
  failure: string
  /** 记号树，一团后端给的自由 JSON；认不出的节点由渲染器降级成占位。 */
  notation: unknown
  /** 一行读法，记号树画不出来时的兜底。 */
  readback: string
  /** 结论仍对应框里这份文本。 */
  isFresh: boolean
}>()
</script>

<template>
  <div class="flex items-start gap-2 text-2xs">
    <DtSpinner v-if="props.status === 'checking'" :size="12" class="mt-0.5" />
    <DtTag v-else-if="props.status === 'invalid'" intent="danger">有误</DtTag>
    <DtTag v-else-if="props.status === 'ok' && props.isFresh" intent="success">
      可用
    </DtTag>

    <p v-if="props.error" class="flex items-start gap-1.5 text-state-danger">
      <DtIcon name="alert-circle" :size="14" class="mt-0.5 shrink-0" />
      <span>{{ props.error }}</span>
    </p>
    <p
      v-else-if="props.failure"
      class="flex items-start gap-1.5 text-state-warning"
    >
      <DtIcon name="alert-triangle" :size="14" class="mt-0.5 shrink-0" />
      <span>
        校验服务连不上（{{
          props.failure
        }}）。这条公式对不对只能等保存时由后端判。
      </span>
    </p>
    <!-- 读法优先画成二维数学式：核对「这条公式在算什么」最直观 -->
    <div v-else-if="props.isFresh && props.notation" class="fe-math">
      <span class="shrink-0 text-text-disabled">读作</span>
      <div class="fe-math__body">
        <FormulaNotation :node="props.notation" />
      </div>
    </div>
    <p v-else-if="props.isFresh && props.readback" class="text-text-disabled">
      读作：{{ props.readback }}
    </p>
  </div>
</template>

<style scoped>
/* 式子居中，超宽时框内横向滚动——长公式不许把整个弹窗撑宽 */
.fe-math {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  padding: 6px 8px;
}

.fe-math__body {
  display: flex;
  flex: 1;
  justify-content: center;
  overflow-x: auto;
  padding: 4px 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.5;
}
</style>
