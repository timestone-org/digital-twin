<script setup lang="ts" generic="TRow extends { id: string }">
/**
 * @fileoverview DtTable —— 列定义驱动的表格，全仓表格只有这一套皮肤。
 * 单元格走具名插槽 `cell-<key>`，插槽名的正确性由
 * app/tests/contract/data-view-slots.contract.spec.ts 兜。
 */
import type { DtTableColumn, DtTableSort } from '@dt/contracts'
import DtIcon from '../DtIcon/DtIcon.vue'

const props = withDefaults(
  defineProps<{
    columns: readonly DtTableColumn[]
    rows: readonly TRow[]
    sort?: DtTableSort | null | undefined
    /** 表格最小宽度，窄屏下由滚动容器横向滚动。 */
    minWidth?: string | undefined
    caption?: string | undefined
    /**
     * 吃满外层给的高度、超出部分在自己的滚动容器里滚。
     * 默认关：单独使用时高度由外层容器决定，开着会在非 flex 父级里白占一格。
     */
    fill?: boolean | undefined
  }>(),
  { sort: null, minWidth: '52rem', fill: false },
)

const emit = defineEmits<{ 'update:sort': [value: DtTableSort] }>()

defineSlots<{
  [key: `cell-${string}`]: (props: { row: TRow; index: number }) => unknown
}>()

/** 读屏要靠它播报当前排序方向，光有箭头图标等于没有。 */
function ariaSort(column: DtTableColumn): 'ascending' | 'descending' | 'none' {
  if (!column.sortable || props.sort?.key !== column.key) return 'none'
  return props.sort.desc ? 'descending' : 'ascending'
}

function onSort(column: DtTableColumn): void {
  if (!column.sortable) return
  const active = props.sort?.key === column.key
  emit('update:sort', { key: column.key, desc: active && !props.sort?.desc })
}
</script>

<template>
  <div class="dt-table__scroll" :class="{ 'is-fill': fill }">
    <table class="dt-table" :style="{ minWidth }">
      <caption v-if="caption" class="dt-table__caption">
        {{
          caption
        }}
      </caption>
      <colgroup>
        <col
          v-for="column in columns"
          :key="column.key"
          :style="column.width ? { width: column.width } : undefined"
        />
      </colgroup>
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            scope="col"
            :class="`is-${column.align ?? 'left'}`"
            :aria-sort="ariaSort(column)"
          >
            <button
              v-if="column.sortable"
              type="button"
              class="dt-table__sort"
              @click="onSort(column)"
            >
              {{ column.label }}
              <DtIcon
                v-if="sort?.key === column.key"
                :name="sort.desc ? 'chevron-down' : 'chevron-up'"
                :size="12"
              />
            </button>
            <template v-else>{{ column.label }}</template>
          </th>
        </tr>
      </thead>
      <tbody>
        <!-- ⚠ key 取 id 不取下标：下标做 key 会在删中间行时把状态串到相邻行 -->
        <tr v-for="(row, index) in rows" :key="row.id">
          <td
            v-for="column in columns"
            :key="column.key"
            :class="`is-${column.align ?? 'left'}`"
          >
            <!-- ⚠ 插槽名拼错不报错，只会渲染成这个占位符 -->
            <slot :name="`cell-${column.key}`" :row="row" :index="index">
              —
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

.dt-table__scroll {
  overflow-x: auto;

  // 铺满态下横纵两个方向都在这里滚，sticky 表头贴的就是这个容器的顶。
  // ⚠ 漏了 min-height: 0 就永远撑破外层而不是内部滚动：flex 子项默认 min-height:auto
  &.is-fill {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
}

.dt-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  line-height: 1.5;

  &__caption {
    padding: 0 0 8px;
    text-align: left;
    font-size: 12px;
    color: var(--text-disabled);
  }

  th {
    // sticky 表头：长列表滚下去以后，没有表头的一屏数字是读不懂的。
    // 必须给不透明底色，否则滚上来的行会从字缝里透出来。
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 12px;
    background: var(--surface-panel);
    box-shadow: inset 0 -1px 0 var(--border-subtle);
    font-size: 11px;
    font-weight: 400;
    color: var(--text-disabled);
    white-space: nowrap;
  }

  td {
    padding: 10px 12px;
    border-bottom: 1px solid rgba(var(--accent-primary-rgb), 0.07);
    color: var(--text-secondary);
    vertical-align: middle;
  }

  tbody tr {
    transition: background 0.15s ease;

    &:hover td {
      background: rgba(var(--accent-primary-rgb), 0.04);
    }

    &:last-child td {
      border-bottom: 0;
    }
  }

  .is-right {
    text-align: right;
  }

  .is-center {
    text-align: center;
  }

  .is-left {
    text-align: left;
  }

  &__sort {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;

    @include ctl.focus-ring;

    &:hover {
      color: var(--text-secondary);
    }
  }

  @include ctl.reduced-motion {
    tbody tr {
      transition: none;
    }
  }
}
</style>
