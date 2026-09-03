<script setup lang="ts">
/**
 * @fileoverview 模型签名的入口契约：调用方要提供哪几列。
 *
 * ⚠ 这里列的是**特征工程之前**的列，与版本上的 `feature_keys`（特征工程之后）
 * 不是一回事。带独热或时间特征的链上两者个数就不同——把后者摆给用户看，他会照
 * 着去填一批根本不该由他提供的派生列（docs/MODELING_PLATFORM_DESIGN.md D4）。
 */
import type { DtDataColumn, ModelingSignatureInput } from '@dt/contracts'
import { DtDataView, DtTag } from '@dt/ui'
import { computed } from 'vue'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'label', label: '要提供的列', card: 'title' },
  { key: 'key', label: '训练时的列 key', width: '12rem' },
  { key: 'dtype', label: '类型', width: '6rem' },
  { key: 'unit', label: '单位', width: '6rem' },
  { key: 'required', label: '必填', width: '9rem' },
]

const EMPTY = {
  title: '这个版本没有留下输入契约',
  hint: '它早于「模型签名」这次升级——重跑一遍那条流水线再发布就有了。',
}

const props = defineProps<{ rows: readonly ModelingSignatureInput[] }>()

/**
 * 补一个 `id` 再交给表。
 *
 * ⚠ `DtDataView` 的行必须带 `id`（它按 id 建 key），而入口契约那几列没有
 * 主键——列 key 本身就是它的唯一标识。
 */
const listed = computed(() =>
  props.rows.map((row) => ({ ...row, id: row.key })),
)
</script>

<template>
  <DtDataView
    view="table"
    :columns="COLUMNS"
    :rows="listed"
    :empty="EMPTY"
    :layout="{ fixedLayout: true, minWidth: '44rem' }"
  >
    <template #cell-label="{ row }">{{ row.label }}</template>
    <template #cell-key="{ row }">
      <code>{{ row.key }}</code>
    </template>
    <template #cell-dtype="{ row }">{{ row.dtype }}</template>
    <template #cell-unit="{ row }">{{ row.unit || '—' }}</template>
    <template #cell-required="{ row }">
      <DtTag v-if="row.is_required" intent="warning" size="sm">必填</DtTag>
      <span v-else class="dt-ml-sig__fill">
        可缺省 → {{ row.default_on_missing }}
      </span>
    </template>
  </DtDataView>
</template>

<style scoped lang="scss">
.dt-ml-sig {
  &__fill {
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);
  }
}

code {
  font-family: var(--font-mono);
}
</style>
