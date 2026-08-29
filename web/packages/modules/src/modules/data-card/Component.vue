<script setup lang="ts">
/**
 * @fileoverview 可组合卡片：这一层只做**格的网格排布**，格里画什么由部件列表定。
 *
 * ⚠ 这里没有一行针对某个部件的代码——加一种部件不必碰它，也碰不到它
 * （docs/MODULE_DATA_CARD_DESIGN.md §4）。
 */
import type {
  InteractionEvent,
  ModuleMeta,
  ModuleSlotMeta,
} from '@dt/contracts'
import { computed, type CSSProperties } from 'vue'

import type {
  CardCellView,
  CardPartMeta,
  CardSlotKey,
} from '../../cardParts/types'
import { CARD_SLOT_KEYS } from '../../cardParts/types'
import {
  readArray,
  readBoolean,
  readEnum,
  readNumber,
  readRecord,
  readText,
} from '../../shared/config'
import { rowClickEmitter } from '../../shared/interaction'
import ModulePanel from '../../shared/ModulePanel.vue'
import Cell from './Cell.vue'
import type { CardCell } from './cells'
import {
  DATA_CARD_CELLS_KEY,
  DATA_CARD_PARTS_KEY,
  DATA_CARD_SLOT_KEY,
  cellFormat,
  readCells,
  readParts,
} from './cells'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

const emit = defineEmits<{ interaction: [event: InteractionEvent] }>()

/** 空值不上抛由它兜着；吞不吞冒泡由 `Cell` 按这一格有没有联动值分开决定。 */
const onPick = rowClickEmitter(emit)

const COLUMNS = ['auto', '1', '2', '3', '4'] as const
const ALIGNS = ['start', 'center', 'end'] as const
const SHELLS = ['plain', 'card', 'accent'] as const

/** 自适应列的最小列宽；比它更窄时读数会先塌，不如换行。 */
const MIN_COLUMN = 120

const cells = computed<CardCell[]>(() =>
  readCells(props.config[DATA_CARD_CELLS_KEY]),
)
const parts = computed(() => readParts(props.config[DATA_CARD_PARTS_KEY]))

const formatDefaults = computed(() => ({
  emptyText: readText(props.config.emptyText, '—'),
  thousands: readBoolean(props.config.thousands, false),
  fixedDecimals: readBoolean(props.config.fixedDecimals, false),
}))

/** 第 i 格的四个子槽取值。⚠ 取不到的键**不放进去**，部件据「键在不在」分得开没接与取不到。 */
function slotValues(index: number): CardCellView['values'] {
  const rows = readArray(props.values[DATA_CARD_SLOT_KEY])
  const row = readRecord(rows[index])
  const out: Partial<Record<CardSlotKey, unknown>> = {}
  for (const key of CARD_SLOT_KEYS) {
    if (row[key] !== undefined) out[key] = row[key]
  }
  return out
}

/** 第 i 格逐子槽的取数结论，键是绑定的 `fieldKey`。 */
function slotMeta(index: number): CardPartMeta {
  const table = props.meta?.slots
  const out: Partial<Record<CardSlotKey, ModuleSlotMeta>> = {}
  if (table === undefined) return { slots: out, hasSlots: false }
  for (const key of CARD_SLOT_KEYS) {
    const found = table[`${DATA_CARD_SLOT_KEY}[${String(index)}].${key}`]
    if (found !== undefined) out[key] = found
  }
  return { slots: out, hasSlots: true }
}

/** 逐格摊平成模板要的那几样，一次算完——模板里不判档位。 */
const rendered = computed(() =>
  cells.value.map((cell, index) => ({
    key: `cell-${String(index)}`,
    emitValue: cell.emitValue,
    view: {
      label: cell.label,
      values: slotValues(index),
      format: cellFormat(cell, formatDefaults.value),
    } satisfies CardCellView,
    meta: slotMeta(index),
  })),
)

const gridStyle = computed<CSSProperties>(() => {
  const columns = readEnum(props.config.columns, COLUMNS, 'auto')
  return {
    gridTemplateColumns:
      columns === 'auto'
        ? `repeat(auto-fit, minmax(${String(MIN_COLUMN)}px, 1fr))`
        : `repeat(${columns}, minmax(0, 1fr))`,
    columnGap: `${String(readNumber(props.config.gapX, 10))}px`,
    rowGap: `${String(readNumber(props.config.gapY, 10))}px`,
    padding: `${String(readNumber(props.config.padY, 6))}px ${String(readNumber(props.config.padX, 10))}px`,
  }
})

/** 下发给格的那几个变量，格与部件按它们排版。 */
const cellVars = computed<CSSProperties>(() => ({
  '--dc-cell-px': `${String(readNumber(props.config.cellPadX, 12))}px`,
  '--dc-cell-py': `${String(readNumber(props.config.cellPadY, 8))}px`,
  '--dc-part-gap': `${String(readNumber(props.config.partGap, 4))}px`,
}))

const shell = computed(() => readEnum(props.config.cellShell, SHELLS, 'plain'))
const align = computed(() => readEnum(props.config.align, ALIGNS, 'center'))
const title = computed(() => readText(props.config.title))
</script>

<template>
  <ModulePanel :title="title">
    <!-- ⚠ 两种空各说各的：一个格都没有 vs 一个部件都没加，排查方向完全不同 -->
    <p v-if="rendered.length === 0" class="dc-empty">还没有格</p>
    <p v-else-if="parts.length === 0" class="dc-empty">还没有加部件</p>
    <div v-else class="dc-grid" :style="gridStyle">
      <Cell
        v-for="one in rendered"
        :key="one.key"
        :cell="one.view"
        :meta="one.meta"
        :parts="parts"
        :shell="shell"
        :align="align"
        :vars="cellVars"
        :emit-value="one.emitValue"
        @pick="onPick"
      />
    </div>
  </ModulePanel>
</template>

<style scoped>
.dc-grid {
  display: grid;
  container-type: inline-size;
  height: 100%;
  align-content: center;
  box-sizing: border-box;
}

.dc-empty {
  margin: 0;
  padding: 12px;
  color: var(--text-disabled);
  font-size: 12px;
  text-align: center;
}
</style>
