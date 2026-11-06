<script setup lang="ts" generic="TRow extends { id: string }">
/**
 * @fileoverview DtDataView —— 同一份数据的表格 / 卡片两种呈现，可就地切换。
 * `columns` 是表格的唯一真源；`cell-<key>` 插槽默认同时喂两种视图，而 `card`
 * 插槽给了就整张卡改由调用方渲染。
 * ⚠ 用 `card` 的页面等于把同一份数据的标记写了两份，「表格里改了、卡片里忘了
 * 改」这份漂移风险就落在页面上——两种视图不同屏，评审也看不出来。凡两种视图
 * 都要出现、且不止一个元素的片段，页面必须抽成子组件供两处共用。
 */
import { computed } from 'vue'
import type {
  DtDataColumn,
  DtDataViewEmpty,
  DtDataViewMode,
  DtSegmentedOption,
  DtTableSort,
} from '@dt/contracts'
import DtCard from '../DtCard/DtCard.vue'
import DtCheckbox from '../DtCheckbox/DtCheckbox.vue'
import DtDataCard from './DtDataCard.vue'
import DtPageState from '../DtPageState/DtPageState.vue'
import DtPagination from '../DtPagination/DtPagination.vue'
import type { DtPaginationState } from '../DtPagination/pages'
import DtSegmented from '../DtSegmented/DtSegmented.vue'
import DtTable from '../DtTable/DtTable.vue'
import type { DtDataViewSelection } from './selection'

export interface DtDataViewLayout {
  minWidth?: string | undefined
  /**
   * 表格视图按 `column.width` 严格排布。列数多、又有一列长文本时必须开——
   * 不开的话浏览器按内容重排，写好的列宽形同虚设（细节见 DtTable）。
   */
  fixedLayout?: boolean | undefined
  /** 关掉内置切换器：多块数据共用页面上一个切换器时用。 */
  toggle?: boolean | undefined
  /** 卡片视图每行**最多**几张。够宽才铺满，窄了自己降列。 */
  cardColumns?: 1 | 2 | 3 | 4 | undefined
  /**
   * 一张卡还读得下去的最小宽度。轨道窄到这个值就少铺一列，
   * 所以它决定的是「什么时候降列」，不是卡片的实际宽度。
   */
  cardMinWidth?: string | undefined
  /**
   * 吃满外层给的高度、超出部分在内部滚动，工具条与分页器不跟着滚。
   * 关掉它按内容高度渲染——一页里若干个分组各一张小表时要的是后者。
   */
  fill?: boolean | undefined
}

const props = withDefaults(
  defineProps<{
    columns: readonly DtDataColumn[]
    rows: readonly TRow[]
    view: DtDataViewMode
    loading?: boolean | undefined
    error?: string | null | undefined
    sort?: DtTableSort | null | undefined
    /** 空态文案。三态里只有「空」需要业务措辞，加载与出错是通用的。 */
    empty?: DtDataViewEmpty | undefined
    /** 呈现方式：这四项都是「怎么摆」，不是「摆什么」。 */
    layout?: DtDataViewLayout | undefined
    /** 给了才渲染分页器；不分页的用法不能凭空多出一条。 */
    pagination?: DtPaginationState | null | undefined
    selection?: DtDataViewSelection<TRow> | undefined
  }>(),
  {
    loading: false,
    error: null,
    sort: null,
    empty: undefined,
    layout: undefined,
    pagination: null,
    selection: undefined,
  },
)

/**
 * 只有「还没有东西可显示」时才让加载态盖住整块。
 *
 * ⚠ 手里已经有行还盖，一次后台轮询就会把整张表闪掉换成转圈：会话表、模型表
 * 这类每几秒刷一次的页面会一直在闪，而闪的那一下既读不到也点不着。刷新是不是
 * 在进行中，由各页工具条上自己的刷新键去说。
 */
const isFirstLoad = computed(() => props.loading && props.rows.length === 0)

const empty = computed(() => ({
  title: props.empty?.title ?? '暂无数据',
  hint: props.empty?.hint,
}))

/**
 * 取调用方给的值，没给就用缺省。抽成函数不是为了短，是为了每加一项 layout
 * 都不必再往这个 computed 里塞一个分支——它已经顶到复杂度上限了。
 * @param given 调用方传的值
 * @param fallback 缺省值
 */
function orDefault<T>(given: T | undefined, fallback: T): T {
  return given ?? fallback
}

const layout = computed(() => {
  const given: DtDataViewLayout = props.layout ?? {}
  return {
    minWidth: orDefault(given.minWidth, '52rem'),
    fixedLayout: orDefault(given.fixedLayout, false),
    toggle: orDefault(given.toggle, true),
    cardColumns: orDefault(given.cardColumns, 2),
    cardMinWidth: orDefault(given.cardMinWidth, '18rem'),
    fill: orDefault(given.fill, true),
  }
})

const emit = defineEmits<{
  'update:view': [value: DtDataViewMode]
  'update:sort': [value: DtTableSort]
  'update:page': [value: number]
  'update:size': [value: number]
  retry: []
  'update:selectedIds': [value: string[]]
}>()

const SELECTION_COLUMN: DtDataColumn = {
  key: '__selection',
  label: '选择',
  width: '3rem',
}
const tableColumns = computed(() =>
  props.selection ? [SELECTION_COLUMN, ...props.columns] : props.columns,
)
const selectedIds = computed(() => new Set(props.selection?.selectedIds ?? []))
const pageIds = computed(() => props.rows.map((row) => row.id))
const selectionLocked = computed(
  () =>
    props.loading || props.selection?.disabled === true || Boolean(props.error),
)
const pageSelection = computed(() => {
  const count = pageIds.value.filter((id) => selectedIds.value.has(id)).length
  return {
    all: count > 0 && count === pageIds.value.length,
    some: count > 0 && count < pageIds.value.length,
  }
})

function updateSelection(ids: readonly string[], isSelected: boolean): void {
  const selection = props.selection
  if (selection === undefined || selectionLocked.value) return
  const next = new Set(selection.selectedIds)
  const visible = new Set(pageIds.value)
  let changed = false
  for (const id of ids) {
    if (!visible.has(id) || next.has(id) === isSelected) continue
    changed = true
    if (isSelected) next.add(id)
    else next.delete(id)
  }
  if (changed) emit('update:selectedIds', [...next])
}

function selectPage(isSelected: boolean): void {
  updateSelection(pageIds.value, isSelected)
}

function selectionLabel(row: TRow): string {
  return `选择 ${props.selection?.rowLabel?.(row) ?? row.id}`
}

defineSlots<{
  toolbar?: () => unknown
  summary?: () => unknown
  pagination?: () => unknown
  /** 卡片视图里的一张卡。给了就整张卡由调用方渲染，不给走内置 DtDataCard。 */
  card?: (props: { row: TRow; index: number }) => unknown
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
  <div class="dt-data-view" :class="{ 'is-fill': layout.fill }">
    <div
      v-if="$slots.toolbar || $slots.summary || layout.toggle || selection"
      class="dt-data-view__bar"
    >
      <div v-if="$slots.toolbar || selection" class="dt-data-view__toolbar">
        <div v-if="selection" class="dt-data-view__selection-control">
          <DtCheckbox
            :model-value="pageSelection.all"
            :indeterminate="pageSelection.some"
            :label="selection.selectAllLabel ?? '选择本页'"
            :aria-label="selection.selectAllLabel ?? '选择本页'"
            :disabled="selectionLocked || rows.length === 0"
            @update:model-value="selectPage"
          />
        </div>
        <slot name="toolbar" />
      </div>
      <div class="dt-data-view__aside">
        <slot name="summary" />
        <DtSegmented
          v-if="layout.toggle"
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
        :loading="isFirstLoad"
        :error="error"
        :empty="rows.length === 0"
        :empty-title="empty.title"
        :empty-hint="empty.hint"
        @retry="emit('retry')"
      >
        <DtTable
          :columns="tableColumns"
          :rows="rows"
          :sort="sort"
          :min-width="layout.minWidth"
          :fixed-layout="layout.fixedLayout"
          :fill="layout.fill"
          :hidden-header-keys="selection ? ['__selection'] : undefined"
          @update:sort="emit('update:sort', $event)"
        >
          <template v-if="selection" #cell-__selection="{ row }">
            <DtCheckbox
              :model-value="selectedIds.has(row.id)"
              :aria-label="selectionLabel(row)"
              :disabled="selectionLocked"
              @update:model-value="updateSelection([row.id], $event)"
            />
          </template>
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
      :loading="isFirstLoad"
      :error="error"
      :empty="rows.length === 0"
      :empty-title="empty.title"
      :empty-hint="empty.hint"
      @retry="emit('retry')"
    >
      <div
        class="dt-data-view__grid"
        :class="`is-cols-${layout.cardColumns}`"
        :style="{ '--dt-card-min': layout.cardMinWidth }"
      >
        <!-- 走插槽的后备内容而不是双分支：两条路径不会同时存在 -->
        <template v-for="(row, index) in rows" :key="row.id">
          <div v-if="selection" class="dt-data-view__selectable-card">
            <div class="dt-data-view__card-select" @click.stop @keydown.stop>
              <DtCheckbox
                :model-value="selectedIds.has(row.id)"
                :aria-label="selectionLabel(row)"
                :disabled="selectionLocked"
                @update:model-value="updateSelection([row.id], $event)"
              />
            </div>
            <slot name="card" :row="row" :index="index">
              <DtDataCard
                :title-column="titleColumn"
                :meta-columns="metaColumns"
                :actions-column="actionsColumn"
                :field-columns="fieldColumns"
              >
                <template
                  v-for="column in columns"
                  :key="column.key"
                  #[cellSlot(column.key)]
                >
                  <slot :name="`cell-${column.key}`" :row="row" :index="index"
                    >—</slot
                  >
                </template>
              </DtDataCard>
            </slot>
          </div>
          <slot v-else name="card" :row="row" :index="index">
            <DtDataCard
              :title-column="titleColumn"
              :meta-columns="metaColumns"
              :actions-column="actionsColumn"
              :field-columns="fieldColumns"
            >
              <template
                v-for="column in columns"
                :key="column.key"
                #[cellSlot(column.key)]
              >
                <slot :name="`cell-${column.key}`" :row="row" :index="index"
                  >—</slot
                >
              </template>
            </DtDataCard>
          </slot>
        </template>
      </div>
    </DtPageState>

    <slot name="pagination">
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
    </slot>
  </div>
</template>

<style scoped lang="scss">
@use './data-view';
</style>
