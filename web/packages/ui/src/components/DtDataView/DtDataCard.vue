<script setup lang="ts">
/**
 * @fileoverview DtDataView 卡片视图里的一张卡：标题行 + 操作 + 字段表。
 * 拆出来是为了把嵌套压回上限——卡片视图是全仓最深的一处。
 *
 * ⚠ 单元格插槽由父组件转发进来（`cell-<key>`），这里只按列取用；
 * 插槽名拼错不会报错，只会静静渲染成 `—`，由契约测试双向锁死。
 */
import type { DtDataColumn } from '@dt/contracts'
import DtCard from '../DtCard/DtCard.vue'

defineProps<{
  titleColumn: DtDataColumn | undefined
  metaColumns: readonly DtDataColumn[]
  actionsColumn: DtDataColumn | undefined
  fieldColumns: readonly DtDataColumn[]
}>()

defineSlots<{
  [key: `cell-${string}`]: () => unknown
}>()
</script>

<template>
  <DtCard padding="sm">
    <template #header>
      <div class="dt-data-view__card-head">
        <div class="dt-data-view__card-title">
          <slot v-if="titleColumn" :name="`cell-${titleColumn.key}`" />
        </div>
        <div
          v-for="column in metaColumns"
          :key="column.key"
          class="dt-data-view__card-meta"
        >
          <slot :name="`cell-${column.key}`" />
        </div>
      </div>
    </template>

    <template v-if="actionsColumn" #actions>
      <slot :name="`cell-${actionsColumn.key}`" />
    </template>

    <dl class="dt-data-view__fields">
      <div v-for="column in fieldColumns" :key="column.key">
        <dt>{{ column.label }}</dt>
        <dd><slot :name="`cell-${column.key}`">—</slot></dd>
      </div>
    </dl>
  </DtCard>
</template>
