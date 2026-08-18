<script setup lang="ts">
/**
 * @fileoverview metric-card 的渲染：把指标列表摆成单格大字／网格／列表行，
 * 每一格交给 `MetricCell`。取值与状态判定全在 `metrics.ts`，这里只管排布。
 *
 * ⚠ 本模块自报 `ownsStatusDisplay`，运行时因此不给它盖整格状态浮层——
 * 四档（未绑定／等待首帧／取不到／有读数）必须逐格画出来，少画一档就是留白。
 */
import type { InteractionEvent, ModuleMeta } from '@dt/contracts'
import { computed, type CSSProperties } from 'vue'

import {
  readBoolean,
  readEnum,
  readNumber,
  readText,
} from '../../shared/config'
import { rowClickEmitter } from '../../shared/interaction'
import ModulePanel from '../../shared/ModulePanel.vue'
import MetricCell from './MetricCell.vue'
import {
  METRIC_ITEMS_KEY,
  METRIC_SLOT_KEY,
  buildMetricCells,
  readMetricItems,
  type MetricLook,
} from './metrics'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

const emit = defineEmits<{ interaction: [event: InteractionEvent] }>()

// 空值不上抛由它兜着：没有联动值的事件没有任何规则用得上
const onPick = rowClickEmitter(emit)

const LAYOUTS = ['auto', 'grid', 'list'] as const
const ALIGNS = ['left', 'center'] as const
const DENSITIES = ['compact', 'normal', 'loose'] as const

/** 三种排布各自的读数字号，`valueSize: 0`（自动）那一档用它。 */
const AUTO_VALUE_SIZE = { single: 40, grid: 24, list: 18 } as const

/** 自动档的列数：项数越多列越多，但不超过四列——再窄就只剩省略号了。 */
function autoColumns(count: number): number {
  if (count <= 1) return 1
  if (count <= 4) return 2
  if (count <= 9) return 3
  return 4
}

const items = computed(() => readMetricItems(props.config[METRIC_ITEMS_KEY]))

const layout = computed(() => readEnum(props.config.layout, LAYOUTS, 'auto'))

/** 单格大字：只有「自动」档且恰好一项时才是它。 */
const isSingle = computed(
  () => layout.value === 'auto' && items.value.length <= 1,
)

const columns = computed(() => {
  if (layout.value === 'list') return 1
  if (layout.value === 'grid') {
    // ⚠ 夹取到清单声明的范围：脏配置里的 0 会让整条 grid 声明作废
    return Math.min(
      6,
      Math.max(1, Math.round(readNumber(props.config.columns, 2))),
    )
  }
  return autoColumns(items.value.length)
})

const cells = computed(() =>
  buildMetricCells({
    items: items.value,
    rows: props.values[METRIC_SLOT_KEY],
    slots: props.meta?.slots,
    emptyText: readText(props.config.emptyText, '—'),
    grouping: readBoolean(props.config.grouping),
  }),
)

const look = computed<MetricLook>(() => ({
  align: isSingle.value
    ? 'center'
    : readEnum(props.config.align, ALIGNS, 'left'),
  valueSize: resolvedValueSize(),
  labelSize: Math.max(8, Math.round(readNumber(props.config.labelSize, 12))),
  valueColor: readText(
    props.config.valueColor,
    'var(--card-text, var(--text-primary))',
  ),
  showStatusDot: readBoolean(props.config.showStatusDot, true),
  showUpdatedAt: readBoolean(props.config.showUpdatedAt),
  isRow: layout.value === 'list',
}))

/** 配 0 = 跟着排布走，否则按配的来。 */
function resolvedValueSize(): number {
  const configured = Math.round(readNumber(props.config.valueSize, 0))
  if (configured > 0) return configured
  if (isSingle.value) return AUTO_VALUE_SIZE.single
  return layout.value === 'list' ? AUTO_VALUE_SIZE.list : AUTO_VALUE_SIZE.grid
}

const gridStyle = computed<CSSProperties>(() => ({
  gridTemplateColumns: `repeat(${columns.value}, minmax(0, 1fr))`,
}))

const density = computed(() =>
  readEnum(props.config.density, DENSITIES, 'normal'),
)

const title = computed(() => readText(props.config.title))
</script>

<template>
  <ModulePanel :title="title">
    <div
      class="metric-card"
      :class="[`metric-card--${density}`, { 'metric-card--single': isSingle }]"
      :style="gridStyle"
    >
      <MetricCell
        v-for="cell in cells"
        :key="cell.key"
        :cell="cell"
        :look="look"
        @pick="onPick"
      />
    </div>
  </ModulePanel>
</template>

<style scoped lang="scss">
.metric-card {
  display: grid;
  overflow: auto;
  align-content: start;
  width: 100%;
  height: 100%;
}

// 只有一项时铺满整块：那一档要的就是「远远看一眼就是这个数」
.metric-card--single {
  align-content: center;
}

.metric-card--compact {
  padding: 6px 8px;
  gap: 6px 10px;
}

.metric-card--normal {
  padding: 10px 12px;
  gap: 12px 16px;
}

.metric-card--loose {
  padding: 14px 16px;
  gap: 20px 24px;
}
</style>
