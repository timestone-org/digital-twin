<script lang="ts">
/**
 * @fileoverview 列表里的一行：`lead ｜ 最多三段 lines ｜ tail`，外加一条扩展指标行。
 * 段位是声明式的——八个参考模块的行结构全部落在这一张网格上（MODULE_INFO_CARD_DESIGN §2.2）。
 * ⚠ 三列对齐档的列宽与表头共用同一份 `--il-cols-tpl`：拆成两处字符串就会错列，
 * 而 typecheck 与 lint 都不管（§2.4）。
 */
import type { ListLead, ListSegment } from './options'
import type { BadgeView, MeterView } from './rowAlarm'
import type { ListRow } from './rows'
import type { CellState } from './rowValue'

/** 一件画什么。`unit` 只在三列对齐档出现（单位独占一列）。 */
type CellKind =
  | 'label'
  | 'value'
  | 'sub'
  | 'badge'
  | 'tag'
  | 'meter'
  | 'alarmText'
  | 'desc'
  | 'time'
  | 'icon'
  | 'extra'
  | 'unit'

/** 一件要画的东西。按 `kind` 取用其中几个字段，其余留空。 */
interface RowCell {
  key: string
  kind: CellKind
  /** 件前面的小字（副读数的 `subLabel` / 扩展指标的名字）；空串 = 不画 */
  label: string
  text: string
  /** 单位；⚠ 非 `ok` 档一律空串——「— kV」看着像是有读数的 */
  unit: string
  /** 图标地址（`icon` 档）；空串 = 回退一个发光圆点 */
  src: string
  /** 读数四档，只有 `value` / `sub` 用得上 */
  state: CellState
  /** 没有读数时的一句话，挂 `title`；有值时空串 */
  reason: string
  badge: BadgeView | null
  meter: MeterView | null
}

type CellSpec = Omit<RowCell, 'key'>

/** 落在同一个段位里的一组件。⚠ 空组不发。 */
interface RowGroup {
  key: string
  at: RowSlot
  pieces: RowCell[]
}

/** 网格列名。`wide` 不是一列，是「铺满正文那几列」。 */
type ColKey = 'lead' | 'left' | 'right' | 'tail' | 'tail2' | 'wide'

const BLANK: CellSpec = {
  kind: 'label',
  label: '',
  text: '',
  unit: '',
  src: '',
  state: 'ok',
  reason: '',
  badge: null,
  meter: null,
}

// 段位件 → 这一行里的哪一处取值；取不到值的件整件不发，不摆一个空位
const CELL_OF: Record<ListSegment, (row: ListRow) => CellSpec | null> = {
  none: () => null,
  label: (row) => ({ ...BLANK, kind: 'label', text: row.label }),
  value: (row) => ({
    ...BLANK,
    kind: 'value',
    text: row.value.text,
    unit: row.value.unit,
    state: row.value.state,
    reason: row.value.reason,
  }),
  sub: (row) => ({
    ...BLANK,
    kind: 'sub',
    label: row.subLabel,
    text: row.sub.text,
    unit: row.sub.unit,
    state: row.sub.state,
    reason: row.sub.reason,
  }),
  badge: (row) =>
    row.badge.kind === 'none'
      ? null
      : { ...BLANK, kind: 'badge', badge: row.badge },
  tag: (row) =>
    row.tag === '' ? null : { ...BLANK, kind: 'tag', text: row.tag },
  meter: (row) =>
    row.meter.show ? { ...BLANK, kind: 'meter', meter: row.meter } : null,
  meter2: (row) =>
    row.meter2.show ? { ...BLANK, kind: 'meter', meter: row.meter2 } : null,
  alarmText: (row) =>
    row.alarmText === ''
      ? null
      : { ...BLANK, kind: 'alarmText', text: row.alarmText },
  desc: (row) =>
    row.desc === '' ? null : { ...BLANK, kind: 'desc', text: row.desc },
  time: (row) =>
    row.time === '' ? null : { ...BLANK, kind: 'time', text: row.time },
}

/**
 * 读数四档各自的修饰类。
 * ⚠ 四档的占位符是同一个「—」，屏上全靠这四个类给的颜色与透明度分开；
 * 类名一处写死而不是模板现拼，是因为拼错了既不报错也不生效。
 */
const STATE_CLASS: Record<CellState, string> = {
  ok: 'il-cell--ok',
  pending: 'il-cell--pending',
  error: 'il-cell--error',
  unbound: 'il-cell--unbound',
}

// 前导列只收这三档：一张通用件表会让「把长描述塞进 24px 宽的列」配得出来
const LEAD_OF: Record<ListLead, (row: ListRow) => CellSpec | null> = {
  none: () => null,
  icon: (row) => ({ ...BLANK, kind: 'icon', src: row.icon }),
  badge: (row) =>
    row.badge.kind === 'none'
      ? null
      : { ...BLANK, kind: 'badge', badge: row.badge },
}

// 第 N 段 line 的左右两组段位名
const LINE_SLOTS: readonly (readonly [RowSlot, RowSlot])[] = [
  ['left1', 'right1'],
  ['left2', 'right2'],
  ['left3', 'right3'],
]

const TAIL_SLOTS = ['tail', 'tail2'] as const

/**
 * 段位 → 落在哪一列的第几段；`line: 0` = 跨全部段位垂直居中。
 * ⚠ 段号按**渲染出来的**段重排：配置里的空段跳过之后仍从 1 起连续，
 * 中间空一段会多出一条空网格行与一道行间距。
 */
const STACK_AT = {
  lead: { col: 'lead', line: 0 },
  tail: { col: 'tail', line: 0 },
  tail2: { col: 'tail2', line: 0 },
  extras: { col: 'wide', line: 0 },
  left1: { col: 'left', line: 1 },
  right1: { col: 'right', line: 1 },
  left2: { col: 'left', line: 2 },
  right2: { col: 'right', line: 2 },
  left3: { col: 'left', line: 3 },
  right3: { col: 'right', line: 3 },
  'col-name': { col: 'left', line: 1 },
  'col-value': { col: 'right', line: 1 },
  'col-unit': { col: 'tail', line: 1 },
} as const satisfies Record<string, { col: ColKey; line: number }>

type RowSlot = keyof typeof STACK_AT

// 三列对齐档的列序
const COLUMN_INDEX: Partial<Record<RowSlot, number>> = {
  'col-name': 1,
  'col-value': 2,
  'col-unit': 3,
}

// 三列对齐档的列宽由 look 下发，缺省值逐字取自参考仓 `tag-table`
const COLUMNS_TPL =
  'var(--il-cols-tpl, minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 8em))'

// 正文左列，可收缩到零宽再让读数列占满
const BODY_COL = 'minmax(0, 1fr)'

const LAYOUT_COLUMNS_CLASS = 'il--layout-columns'
const UNIT_COLUMN_CLASS = 'il--unit-column'
</script>

<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'

import CellBadge from './CellBadge.vue'
import MeterBar from '../../shared/MeterBar.vue'
import type { ListLook } from './look'

const props = defineProps<{ row: ListRow; look: ListLook }>()

const emit = defineEmits<{ pick: [value: string] }>()

const isColumns = computed(() =>
  props.look.classes.includes(LAYOUT_COLUMNS_CLASS),
)

/**
 * 一个段位件在这一行里对应的那一件；取不到值给 null。
 * @param seg 段位件名
 * @param key `v-for` 的键
 */
function segCell(seg: ListSegment, key: string): RowCell | null {
  const made = CELL_OF[seg](props.row)
  return made === null ? null : { key, ...made }
}

/**
 * 一组段位件里真画得出来的那几件。
 * @param segs 这一组的段位件名
 * @param prefix 键前缀
 */
function cellsOf(segs: readonly ListSegment[], prefix: string): RowCell[] {
  const out: RowCell[] = []
  segs.forEach((seg, index) => {
    const cell = segCell(seg, `${prefix}${String(index)}`)
    if (cell !== null) out.push(cell)
  })
  return out
}

function leadGroups(): RowGroup[] {
  const made = LEAD_OF[props.look.shape.lead](props.row)
  return made === null
    ? []
    : [{ key: 'lead', at: 'lead', pieces: [{ key: 'lead', ...made }] }]
}

/** ⚠ 段号按渲染出来的段重排：配置里的段一件都画不出来时不占网格行。 */
function lineGroups(): RowGroup[] {
  const out: RowGroup[] = []
  let line = 0
  for (const spec of props.look.lines) {
    const left = cellsOf([spec.left, spec.left2], `${spec.key}:l`)
    const right = cellsOf([spec.right, spec.right2], `${spec.key}:r`)
    if (left.length === 0 && right.length === 0) continue
    const slots = LINE_SLOTS[line]
    if (slots === undefined) break
    line += 1
    if (left.length > 0) out.push({ key: slots[0], at: slots[0], pieces: left })
    if (right.length > 0) {
      out.push({ key: slots[1], at: slots[1], pieces: right })
    }
  }
  return out
}

function tailGroups(): RowGroup[] {
  const out: RowGroup[] = []
  for (const at of TAIL_SLOTS) {
    const cell = segCell(props.look.shape[at], at)
    if (cell !== null) out.push({ key: at, at, pieces: [cell] })
  }
  return out
}

/** 扩展指标行：⚠ 有值的那几格才在 `row.extras` 里，真实 0 算有值。 */
function extrasGroups(): RowGroup[] {
  if (!props.look.shape.extras || props.row.extras.length === 0) return []
  const pieces = props.row.extras.map((extra) => ({
    ...BLANK,
    kind: 'extra' as const,
    key: extra.key,
    label: extra.label,
    text: extra.text,
    unit: extra.unit,
  }))
  return [{ key: 'extras', at: 'extras', pieces }]
}

/** 三列对齐档：名称 ｜ 数值 ｜ 单位，`rowLines` 与 `rowShape` 在这一档不生效。 */
function columnGroups(): RowGroup[] {
  const row = props.row
  const split = props.look.classes.includes(UNIT_COLUMN_CLASS)
  const value: RowCell = {
    ...BLANK,
    key: 'value',
    kind: 'value',
    text: row.value.text,
    unit: split ? '' : row.value.unit,
    state: row.value.state,
    reason: row.value.reason,
  }
  const out: RowGroup[] = [
    {
      key: 'col-name',
      at: 'col-name',
      pieces: [{ ...BLANK, key: 'name', kind: 'label', text: row.label }],
    },
    { key: 'col-value', at: 'col-value', pieces: [value] },
  ]
  if (!split || row.value.unit === '') return out
  out.push({
    key: 'col-unit',
    at: 'col-unit',
    pieces: [{ ...BLANK, key: 'unit', kind: 'unit', text: row.value.unit }],
  })
  return out
}

const groups = computed<RowGroup[]>(() =>
  isColumns.value
    ? columnGroups()
    : [...leadGroups(), ...lineGroups(), ...tailGroups(), ...extrasGroups()],
)

/** 列模板与列序：只摆真有内容的列，空列会白白多出一道 `column-gap`。 */
const grid = computed(() => {
  const index: Partial<Record<ColKey, number>> = {}
  if (isColumns.value) {
    return { template: COLUMNS_TPL, index, lines: 1, bodyEnd: 4 }
  }
  const used = new Set<ColKey>()
  let lines = 0
  for (const group of groups.value) {
    const at = STACK_AT[group.at]
    used.add(at.col)
    lines = Math.max(lines, at.line)
  }
  const parts: string[] = []
  if (used.has('lead')) index.lead = parts.push('auto')
  index.left = parts.push(BODY_COL)
  if (used.has('right')) index.right = parts.push('auto')
  if (used.has('tail')) index.tail = parts.push('auto')
  if (used.has('tail2')) index.tail2 = parts.push('auto')
  const bodyEnd = (index.right ?? index.left) + 1
  return { template: parts.join(' '), index, lines, bodyEnd }
})

const hasExtras = computed(() =>
  groups.value.some((group) => group.at === 'extras'),
)

/** 网格总行数：渲染出来的段数加上扩展指标行。 */
const totalRows = computed(() =>
  Math.max(1, grid.value.lines + (hasExtras.value ? 1 : 0)),
)

/**
 * 一组件落在哪一格。
 * @param group 要摆的那一组
 */
function groupStyle(group: RowGroup): CSSProperties {
  if (isColumns.value) {
    return { gridColumn: String(COLUMN_INDEX[group.at] ?? 1), gridRow: '1' }
  }
  const at = STACK_AT[group.at]
  const span = grid.value
  if (at.col === 'wide') {
    return {
      gridColumn: `${String(span.index.left ?? 1)} / ${String(span.bodyEnd)}`,
      gridRow: String(span.lines + 1),
    }
  }
  const column = String(span.index[at.col] ?? 1)
  return at.line === 0
    ? { gridColumn: column, gridRow: `1 / span ${String(totalRows.value)}` }
    : { gridColumn: column, gridRow: String(at.line) }
}

/** 与别的件同行的那几段：这些段里的行名只截一行。 */
const busyLines = computed(() => {
  const busy = new Set<number>()
  for (const group of groups.value) {
    const at = STACK_AT[group.at]
    if (at.line === 0) continue
    if (at.col === 'right' || group.pieces.length > 1) busy.add(at.line)
  }
  return busy
})

/**
 * 行名独占一整段时折两行，否则单行省略号。
 * @param group 这一件所在的组
 * @param cell 这一件
 */
function isClamped(group: RowGroup, cell: RowCell): boolean {
  if (cell.kind !== 'label' || isColumns.value) return false
  const at = STACK_AT[group.at]
  return at.line > 0 && !busyLines.value.has(at.line)
}

/**
 * 这一件的读数档修饰类。⚠ 四档的占位符是同一个「—」，全靠这个类分开。
 * @param cell 这一件
 */
function stateClass(cell: RowCell): string {
  return cell.kind === 'value' || cell.kind === 'sub'
    ? STATE_CLASS[cell.state]
    : ''
}

const rowStyle = computed<CSSProperties>(() => ({
  ...props.row.vars,
  gridTemplateColumns: grid.value.template,
}))

const rowClasses = computed(() => [
  ...props.look.classes,
  {
    'il-row--alarm': props.row.isAlarm,
    'il-row--blink': props.row.blink,
    'il-row--pick': props.row.emitValue !== '',
  },
])

/**
 * 点这一行。
 * ⚠ 吞冒泡是**有条件**的：配了联动值就吞（否则同一次点击会再被「整块可点」兜底
 * 抛一个没有 value 的 click，toggle 类动作当场自我抵消）；没配就放它上去。
 * @param event 原生点击事件
 */
function onPick(event: MouseEvent): void {
  if (props.row.emitValue === '') return
  event.stopPropagation()
  emit('pick', props.row.emitValue)
}
</script>

<template>
  <div class="il-row" :class="rowClasses" :style="rowStyle" @click="onPick">
    <div
      v-for="group in groups"
      :key="group.key"
      class="il-group"
      :class="`il-group--${group.at}`"
      :style="groupStyle(group)"
    >
      <template v-for="cell in group.pieces" :key="cell.key">
        <img
          v-if="cell.kind === 'icon' && cell.src !== ''"
          class="il-icon"
          :src="cell.src"
          alt=""
        />
        <i
          v-else-if="cell.kind === 'icon'"
          class="il-icon-dot"
          aria-hidden="true"
        />
        <CellBadge
          v-else-if="cell.badge !== null"
          :badge="cell.badge"
          :variant="look.badge.style"
        />
        <MeterBar
          v-else-if="cell.meter !== null"
          :meter="cell.meter"
          :dot="look.meter.dot"
        />
        <p v-else-if="cell.kind === 'desc'" class="il-desc">{{ cell.text }}</p>
        <span
          v-else
          class="il-text"
          :class="[
            `il-text--${cell.kind}`,
            stateClass(cell),
            { 'il-text--clamp': isClamped(group, cell) },
          ]"
          :title="cell.reason === '' ? undefined : cell.reason"
        >
          <i v-if="cell.label !== ''" class="il-text__label">{{
            cell.label
          }}</i>
          <span class="il-text__num">{{ cell.text }}</span>
          <i v-if="cell.unit !== ''" class="il-text__unit">{{ cell.unit }}</i>
        </span>
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use './row';
</style>
