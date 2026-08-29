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
import { computed, ref, type CSSProperties } from 'vue'

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
import { toNumOrNull } from '../../shared/format'
import { rowClickEmitter } from '../../shared/interaction'
import ModulePanel from '../../shared/ModulePanel.vue'
import { readScrollSettings } from '../../shared/scroll'
import ScrollList from '../../shared/ScrollList.vue'
import { normalizeValueRules } from '../../shared/valueRules'
import Cell from './Cell.vue'
import {
  CARD_GROUPINGS,
  evaluateCells,
  pickGroup,
  toCardGroups,
} from './groups'
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

/** 第 i 格的逐子槽取值。⚠ 取不到的键**不放进去**，部件据「键在不在」分得开没接与取不到。 */
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

/**
 * 全卡各子槽的合计，「占全卡之比」那一档用它。
 * ⚠ 一个数都取不到的槽**不进表**：留个 0 会让占比算成除零，画出来是 Infinity%。
 * ⚠ 负数照常计入：现场的负值（回馈电量、逆流）是真实的，替用户抹掉它就是在改数。
 */
const slotTotals = computed<CardCellView['totals']>(() => {
  const rows = readArray(props.values[DATA_CARD_SLOT_KEY])
  const out: Partial<Record<CardSlotKey, number>> = {}
  for (const key of CARD_SLOT_KEYS) {
    let sum = 0
    let seen = false
    for (const one of rows) {
      const num = toNumOrNull(readRecord(one)[key])
      if (num === null) continue
      sum += num
      seen = true
    }
    if (seen) out[key] = sum
  }
  return out
})

/** 逐格摊平成模板要的那几样，一次算完——模板里不判档位。 */
const rendered = computed(() =>
  cells.value.map((cell, index) => ({
    key: `cell-${String(index)}`,
    index,
    emitValue: cell.emitValue,
    view: {
      label: cell.label,
      icon: cell.icon,
      values: slotValues(index),
      totals: slotTotals.value,
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

const grouping = computed(() =>
  readEnum(props.config.grouping, CARD_GROUPINGS, 'none'),
)

const groups = computed(() =>
  grouping.value === 'none'
    ? []
    : toCardGroups(cells.value.map((cell) => cell.group)),
)

/** 页签档：用户点过之后由它说了算，没点过跟着配置里的初始分组。 */
const picked = ref('')

const activeGroup = computed(() =>
  pickGroup(groups.value, picked.value || readText(props.config.defaultGroup)),
)

/** 规则判的是哪一个槽。 */
const alarmSlot = computed<CardSlotKey>(() =>
  readEnum(props.config.alarmOn, CARD_SLOT_KEYS, 'value'),
)

const alarms = computed(() =>
  evaluateCells(
    cells.value.map((_cell, index) => slotValues(index)[alarmSlot.value]),
    normalizeValueRules(props.config.rules),
  ),
)

/**
 * 摆出来的那几段：不分组时一段无名的，分段档每组一段，页签档只摆选中的那一段。
 * ⚠ 页签的计数用**全量格数**：切到某一页再看计数会变，是第一眼就当成 bug 的不一致。
 */
const sections = computed(() => {
  if (grouping.value === 'none') {
    return [{ name: '', cells: rendered.value }]
  }
  const shown =
    grouping.value === 'tabs'
      ? groups.value.filter((one) => one.name === activeGroup.value)
      : groups.value
  return shown.map((group) => ({
    name: grouping.value === 'tabs' ? '' : group.name,
    cells: group.indexes.flatMap((at) => {
      const one = rendered.value[at]
      return one === undefined ? [] : [one]
    }),
  }))
})

// ⚠ 两个滚动键要在这里字面读一遍：`shared/scroll.ts` 写的是 `config?.autoScroll`，
//   可选链绕过了「死字段」闸的正则，那道闸会把这两个键判成声明了没人读
const scroll = computed(() =>
  readScrollSettings({
    autoScroll: props.config.autoScroll,
    scrollSpeed: props.config.scrollSpeed,
  }),
)
</script>

<template>
  <ModulePanel :title="title">
    <!-- ⚠ 两种空各说各的：一个格都没有 vs 一个部件都没加，排查方向完全不同 -->
    <p v-if="rendered.length === 0" class="dc-empty">还没有格</p>
    <p v-else-if="parts.length === 0" class="dc-empty">还没有加部件</p>
    <template v-else>
      <div v-if="grouping === 'tabs'" class="dc-tabs" role="tablist">
        <button
          v-for="group in groups"
          :key="group.name"
          type="button"
          class="dc-tabs__one"
          :class="{ 'dc-tabs__one--on': group.name === activeGroup }"
          role="tab"
          :aria-selected="group.name === activeGroup"
          @click="picked = group.name"
        >
          {{ group.name }}
          <i class="dc-tabs__n">{{ group.indexes.length }}</i>
        </button>
      </div>
      <ScrollList
        :item-count="rendered.length"
        :auto-scroll="scroll.autoScroll"
        :seconds-per-item="scroll.scrollSpeed"
      >
        <section
          v-for="(part, at) in sections"
          :key="`sec-${String(at)}`"
          class="dc-sec"
        >
          <h4 v-if="part.name !== ''" class="dc-sec__head">{{ part.name }}</h4>
          <div class="dc-grid" :style="gridStyle">
            <Cell
              v-for="one in part.cells"
              :key="one.key"
              :cell="one.view"
              :meta="one.meta"
              :parts="parts"
              :shell="shell"
              :align="align"
              :vars="cellVars"
              :emit-value="one.emitValue"
              :alarm="alarms[one.index] ?? null"
              @pick="onPick"
            />
          </div>
        </section>
      </ScrollList>
    </template>
  </ModulePanel>
</template>

<style scoped>
/* 页签条：贴在内容之上，横向可滚，组多时不挤压卡片本体 */
.dc-tabs {
  display: flex;
  flex: none;
  gap: 4px;
  overflow-x: auto;
  padding: 2px 10px 6px;
  scrollbar-width: none;
}

.dc-tabs__one {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 12px;
}

.dc-tabs__one--on {
  border-color: color-mix(in srgb, var(--accent-primary) 55%, transparent);
  background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
  color: var(--accent-primary);
}

/* ⚠ 计数用全量格数，不随选中的页签变 */
.dc-tabs__n {
  color: var(--text-disabled);
  font-size: 11px;
  font-style: normal;
}

.dc-sec__head {
  margin: 0;
  padding: 4px 10px 2px;
  color: var(--text-disabled);
  font-size: 11px;
  letter-spacing: 0.06em;
}

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
