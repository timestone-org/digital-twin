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
    /**
     * 列宽按 `column.width` 严格排布（`table-layout: fixed`）。
     *
     * ⚠ 默认的 auto 布局下 `column.width` **只是建议**：浏览器按内容重新分配，
     * 实测一列写着 10rem 却排出 206px、另一列没写宽度就被压到 76px。开着它，
     * 写多少就是多少，没写宽度的那些列平分剩余空间——想让某一列吃掉剩余空间，
     * 就只留它一列不写宽度。
     * ⚠ 开了它，单元格不再被内容撑开，长文本必须自己 truncate，否则会溢出到
     * 相邻列上（组件不给 td 加 overflow: hidden——那会连按钮的焦点环一起裁掉）。
     */
    fixedLayout?: boolean | undefined
    caption?: string | undefined
    /**
     * 吃满外层给的高度、超出部分在自己的滚动容器里滚。
     * 默认关：单独使用时高度由外层容器决定，开着会在非 flex 父级里白占一格。
     */
    fill?: boolean | undefined
    /** 隐去指定列的表头文字，列名仍作为可访问名称保留。 */
    hiddenHeaderKeys?: readonly string[] | undefined
  }>(),
  {
    sort: null,
    minWidth: '52rem',
    fixedLayout: false,
    fill: false,
    hiddenHeaderKeys: () => [],
  },
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
function isHeaderHidden(column: DtTableColumn): boolean {
  return props.hiddenHeaderKeys.includes(column.key)
}

/**
 * 贴边列的类名：只认首列 start、末列 end，其余位置的声明不生效。
 * @param column 列定义
 * @param index 列序号
 */
function stickyClass(column: DtTableColumn, index: number): string | null {
  if (column.sticky === 'start' && index === 0) return 'is-sticky-start'
  const isLast = index === props.columns.length - 1
  if (column.sticky === 'end' && isLast) return 'is-sticky-end'
  return null
}
</script>

<template>
  <div class="dt-table__scroll" :class="{ 'is-fill': fill }">
    <table
      class="dt-table"
      :class="{ 'is-fixed': fixedLayout }"
      :style="{ minWidth }"
    >
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
            v-for="(column, col) in columns"
            :key="column.key"
            scope="col"
            :class="[`is-${column.align ?? 'left'}`, stickyClass(column, col)]"
            :aria-sort="ariaSort(column)"
            :aria-label="isHeaderHidden(column) ? column.label : undefined"
          >
            <button
              v-if="column.sortable"
              type="button"
              class="dt-table__sort"
              :aria-label="isHeaderHidden(column) ? column.label : undefined"
              @click="onSort(column)"
            >
              <template v-if="!isHeaderHidden(column)">{{
                column.label
              }}</template>
              <DtIcon
                v-if="sort?.key === column.key"
                :name="sort.desc ? 'chevron-down' : 'chevron-up'"
                :size="12"
              />
            </button>
            <template v-else-if="!isHeaderHidden(column)">{{
              column.label
            }}</template>
          </th>
        </tr>
      </thead>
      <tbody>
        <!-- ⚠ key 取 id 不取下标：下标做 key 会在删中间行时把状态串到相邻行 -->
        <tr v-for="(row, index) in rows" :key="row.id">
          <td
            v-for="(column, col) in columns"
            :key="column.key"
            :class="[`is-${column.align ?? 'left'}`, stickyClass(column, col)]"
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

// 贴边单元格的不透明底：面板色多半半透明，叠在页面底色上才盖得住滚过去的内容
@mixin opaque-fill($tint: null) {
  @if $tint {
    background:
      linear-gradient($tint, $tint),
      linear-gradient(var(--surface-panel), var(--surface-panel)),
      var(--surface-base);
  } @else {
    background:
      linear-gradient(var(--surface-panel), var(--surface-panel)),
      var(--surface-base);
  }
}

$row-hover: rgba(var(--accent-primary-rgb), 0.04);

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
  font-size: var(--font-size-body);
  line-height: 1.5;

  &.is-fixed {
    table-layout: fixed;
  }

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
    z-index: 2;
    padding: 12px;
    @include opaque-fill;
    box-shadow: inset 0 -1px 0 var(--border-subtle);
    font-size: var(--font-size-compact);
    font-weight: 500;
    color: var(--text-secondary);
    white-space: nowrap;
    // 定宽列里列名长过列宽时截成省略号：表头不裁切会直接盖到相邻表头上
    overflow: hidden;
    text-overflow: ellipsis;
  }

  td {
    padding: 10px 12px;
    border-bottom: 1px solid rgba(var(--accent-primary-rgb), 0.07);
    color: var(--text-secondary);
    vertical-align: middle;
  }

  // 贴边列：横向滚动时操作列 / 首列不被挤出视口，分界线提示后面还有内容
  td.is-sticky-start,
  td.is-sticky-end {
    position: sticky;
    z-index: 1;
    @include opaque-fill;
  }

  .is-sticky-start {
    left: 0;
    box-shadow: inset -1px 0 0 var(--border-subtle);
  }

  .is-sticky-end {
    right: 0;
    box-shadow: inset 1px 0 0 var(--border-subtle);
  }

  th.is-sticky-start,
  th.is-sticky-end {
    z-index: 3;
  }

  th.is-sticky-start {
    box-shadow:
      inset -1px 0 0 var(--border-subtle),
      inset 0 -1px 0 var(--border-subtle);
  }

  th.is-sticky-end {
    box-shadow:
      inset 1px 0 0 var(--border-subtle),
      inset 0 -1px 0 var(--border-subtle);
  }

  tbody tr {
    transition: background 0.15s ease;

    &:hover td {
      background: $row-hover;
    }

    &:hover td.is-sticky-start,
    &:hover td.is-sticky-end {
      @include opaque-fill($row-hover);
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
