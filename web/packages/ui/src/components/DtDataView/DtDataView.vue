<script setup lang="ts" generic="TRow extends { id: string }">
/**
 * @fileoverview DtDataView —— 同一份数据的表格 / 卡片两种呈现，可就地切换。
 * ⚠ 一套列定义 + 一套 `cell-<key>` 插槽喂两种视图：各写一份必然出现
 * 「表格里改了、卡片里忘了改」，而两种视图不会同屏，评审也看不出来。
 */
import { computed } from 'vue'
import type {
  DtDataColumn,
  DtDataViewMode,
  DtSegmentedOption,
  DtTableSort,
} from '@dt/contracts'
import DtCard from '../DtCard/DtCard.vue'
import DtPageState from '../DtPageState/DtPageState.vue'
import DtPagination from '../DtPagination/DtPagination.vue'
import type { DtPaginationState } from '../DtPagination/pages'
import DtSegmented from '../DtSegmented/DtSegmented.vue'
import DtTable from '../DtTable/DtTable.vue'

const props = withDefaults(
  defineProps<{
    columns: readonly DtDataColumn[]
    rows: readonly TRow[]
    view: DtDataViewMode
    loading?: boolean | undefined
    error?: string | null | undefined
    emptyTitle?: string | undefined
    emptyHint?: string | undefined
    sort?: DtTableSort | null | undefined
    minWidth?: string | undefined
    /** 关掉内置切换器：多块数据共用页面上一个切换器时用。 */
    toggle?: boolean | undefined
    /** 卡片视图每行几张。窄屏一律单列。 */
    cardColumns?: 1 | 2 | 3 | undefined
    /**
     * 吃满外层给的高度、超出部分在内部滚动，工具条与分页器不跟着滚。
     * 关掉它按内容高度渲染——一页里若干个分组各一张小表时要的是后者。
     */
    fill?: boolean | undefined
    /** 给了才渲染分页器；不分页的用法不能凭空多出一条。 */
    pagination?: DtPaginationState | null | undefined
  }>(),
  {
    loading: false,
    error: null,
    emptyTitle: '暂无数据',
    sort: null,
    minWidth: '52rem',
    toggle: true,
    cardColumns: 2,
    fill: true,
    pagination: null,
  },
)

const emit = defineEmits<{
  'update:view': [value: DtDataViewMode]
  'update:sort': [value: DtTableSort]
  'update:page': [value: number]
  'update:size': [value: number]
  retry: []
}>()

defineSlots<{
  toolbar?: () => unknown
  summary?: () => unknown
  [key: `cell-${string}`]: (props: { row: TRow; index: number }) => unknown
}>()

const VIEW_OPTIONS: readonly DtSegmentedOption[] = [
  { value: 'table', label: '表格视图', icon: 'table', iconOnly: true },
  { value: 'card', label: '卡片视图', icon: 'layout-grid', iconOnly: true },
]

/**
 * 插槽名要在 `v-for` 里现算，而动态插槽名写在属性名位置、不能带反引号，
 * 只能走函数。
 * @param key 列标识
 */
function cellSlot(key: string): `cell-${string}` {
  return `cell-${key}`
}

/** DtSegmented 抛的是 string，用窄化收口而不是 `as` 断言。 */
function onView(value: string): void {
  if (value === 'table' || value === 'card') emit('update:view', value)
}

const titleColumn = computed(() =>
  props.columns.find((column) => column.card === 'title'),
)
const metaColumns = computed(() =>
  props.columns.filter((column) => column.card === 'meta'),
)
const actionsColumn = computed(() =>
  props.columns.find((column) => column.card === 'actions'),
)
/** 卡片正文里逐行铺开的字段。没标 card 的列默认落到这里。 */
const fieldColumns = computed(() =>
  props.columns.filter(
    (column) => column.card === undefined || column.card === 'field',
  ),
)
</script>

<template>
  <div class="dt-data-view" :class="{ 'is-fill': fill }">
    <div
      v-if="$slots.toolbar || $slots.summary || toggle"
      class="dt-data-view__bar"
    >
      <div v-if="$slots.toolbar" class="dt-data-view__toolbar">
        <slot name="toolbar" />
      </div>
      <div class="dt-data-view__aside">
        <slot name="summary" />
        <DtSegmented
          v-if="toggle"
          :model-value="view"
          :options="VIEW_OPTIONS"
          aria-label="切换展示方式"
          @update:model-value="onView"
        />
      </div>
    </div>

    <!-- 三态统一由 DtPageState 给；空态从 rows 推导，不另开会和数据打架的 prop -->
    <DtCard v-if="view === 'table'" class="dt-data-view__panel" padding="none">
      <DtPageState
        :loading="loading"
        :error="error"
        :empty="rows.length === 0"
        :empty-title="emptyTitle"
        :empty-hint="emptyHint"
        @retry="emit('retry')"
      >
        <DtTable
          :columns="columns"
          :rows="rows"
          :sort="sort"
          :min-width="minWidth"
          :fill="fill"
          @update:sort="emit('update:sort', $event)"
        >
          <template
            v-for="column in columns"
            :key="column.key"
            #[cellSlot(column.key)]="cell"
          >
            <slot :name="`cell-${column.key}`" v-bind="cell">—</slot>
          </template>
        </DtTable>
      </DtPageState>
    </DtCard>

    <DtPageState
      v-else
      :loading="loading"
      :error="error"
      :empty="rows.length === 0"
      :empty-title="emptyTitle"
      :empty-hint="emptyHint"
      @retry="emit('retry')"
    >
      <div class="dt-data-view__grid" :class="`is-cols-${cardColumns}`">
        <DtCard v-for="(row, index) in rows" :key="row.id" padding="sm">
          <template #header>
            <div class="dt-data-view__card-head">
              <div class="dt-data-view__card-title">
                <slot
                  v-if="titleColumn"
                  :name="`cell-${titleColumn.key}`"
                  :row="row"
                  :index="index"
                />
              </div>
              <div
                v-for="column in metaColumns"
                :key="column.key"
                class="dt-data-view__card-meta"
              >
                <slot :name="`cell-${column.key}`" :row="row" :index="index" />
              </div>
            </div>
          </template>
          <template v-if="actionsColumn" #actions>
            <slot
              :name="`cell-${actionsColumn.key}`"
              :row="row"
              :index="index"
            />
          </template>

          <dl class="dt-data-view__fields">
            <div v-for="column in fieldColumns" :key="column.key">
              <dt>{{ column.label }}</dt>
              <dd>
                <slot :name="`cell-${column.key}`" :row="row" :index="index">
                  —
                </slot>
              </dd>
            </div>
          </dl>
        </DtCard>
      </div>
    </DtPageState>

    <DtPagination
      v-if="pagination"
      class="dt-data-view__pager"
      :page="pagination.page"
      :size="pagination.size"
      :total="pagination.total"
      :size-options="pagination.sizeOptions"
      @update:page="emit('update:page', $event)"
      @update:size="emit('update:size', $event)"
    />
  </div>
</template>

<style scoped lang="scss">
@use './data-view';
</style>
