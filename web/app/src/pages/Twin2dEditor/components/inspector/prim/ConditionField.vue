<script setup lang="ts">
/**
 * @fileoverview 一条变体条件的编辑面：七档闭合条件（交互态 / 运行状态 / 节点标签 /
 * 槽位读数 / 槽位有没有值 / 节点字段 / 取反），`not` 逐层递归。图元的 `when` 与变体的
 * `when` 共用它。
 *
 * ⚠ 填不全的一条会被 `normalizeCondition` **整条丢弃**：丢弃之后图元的 `when` 变
 *   `null`（= 恒渲染）、变体则整条消失，两处都零报错，用户看到的是「我配的条件存了
 *   一次就没了」。所以空槽键、空名单、空标签键在这里当场标红。
 * ⚠ 槽位读数的界值留空**不是「不限」而是「永不成立」**（`matchSlot` 见到 null 直接
 *   判假），`between` / `outside` 的第二个界同理。不标红的话用户配的报警变体一次都
 *   不会亮，而每一格取值单看都对。
 * ⚠ 取反的层数上限与 `normalizeCondition` 里那份私有上限对齐：再深一层会让**整条**
 *   条件被判空，不是只丢里面那一层。两份口径由本控件的用例钉在一起。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import {
  TWIN_2D_CONDITION_KINDS,
  TWIN_2D_FIELD_TESTS,
  TWIN_2D_HAS_MODES,
  TWIN_2D_NODE_FIELDS,
  TWIN_2D_STATES,
  TWIN_2D_STATUSES,
  TWIN_2D_THRESHOLD_OPS,
} from '@dt/twin2d'
import type {
  Twin2dCondition,
  Twin2dConditionKind,
  Twin2dFieldTest,
  Twin2dHasMode,
  Twin2dNodeField,
  Twin2dState,
  Twin2dStatus,
  Twin2dThresholdOp,
} from '@dt/twin2d'
import { DtButton, DtCheckbox, DtInput, DtNumberInput, DtSelect } from '@dt/ui'
import { computed } from 'vue'

import { enumOptions } from '../../../scripts/inspectorFields'
import StringListField from './StringListField.vue'

type TagCond = Extract<Twin2dCondition, { kind: 'tag' }>
type SlotCond = Extract<Twin2dCondition, { kind: 'slot' }>
type HasCond = Extract<Twin2dCondition, { kind: 'has' }>
type FieldCond = Extract<Twin2dCondition, { kind: 'field' }>

const props = defineProps<{
  modelValue: Twin2dCondition | null
  /** 这一层在条件里的深度，根是 0；`not` 递归时逐层加一。 */
  depth?: number
  /** 这一格必须有条件（变体那一处），不摆「不判条件」的出口。 */
  required?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [Twin2dCondition | null]
  blur: []
}>()

/**
 * 取反最深能落在第几层。
 * ⚠ 与 `normalizeCondition` 里那份私有上限对齐：那边是「深度 > 4 判空」，于是最里层
 * 的条件只能落在 4，`not` 自己最深只能落在 3。
 */
const MAX_NOT_DEPTH = 3

const NEED_SLOT = '必填：没有槽键的这一条会在存盘时被整条丢掉'
const NEED_KEY = '必填：没有标签键的这一条会在存盘时被整条丢掉'
const NEED_LIST = '至少填一项：空名单的这一条会在存盘时被整条丢掉'
const NEED_BOUND = '留空不是「不限」而是「永不成立」：这条条件一次都不会命中'

const KIND_LABELS: Readonly<Record<Twin2dConditionKind, string>> = {
  state: '交互态',
  status: '运行状态',
  tag: '节点标签',
  slot: '槽位读数',
  has: '槽位有没有值',
  field: '节点字段',
  not: '取反',
}

const STATE_LABELS: Readonly<Record<Twin2dState, string>> = {
  hover: '悬浮',
  selected: '选中',
  alarm: '报警',
  active: '活跃',
  flipped: '翻面',
}

const STATUS_LABELS: Readonly<Record<Twin2dStatus, string>> = {
  online: '在线',
  offline: '离线',
  warning: '预警',
  alarm: '报警',
}

const OP_LABELS: Readonly<Record<Twin2dThresholdOp, string>> = {
  lt: '< 小于',
  lte: '≤ 小于等于',
  gt: '> 大于',
  gte: '≥ 大于等于',
  between: '区间内 [a,b]',
  outside: '区间外',
  eq: '= 等于',
  neq: '≠ 不等于',
}

const FIELD_LABELS: Readonly<Record<Twin2dNodeField, string>> = {
  labelPos: '显示名位置',
  badge: '角标文字',
  badgeShape: '角标形状',
}

const TEST_LABELS: Readonly<Record<Twin2dFieldTest, string>> = {
  in: '取值落在名单里',
  present: '只要有值',
}

const MODE_LABELS: Readonly<Record<Twin2dHasMode, string>> = {
  any: '任意一个有值',
  all: '每一个都有值',
}

const STATE_OPTIONS = enumOptions(TWIN_2D_STATES, STATE_LABELS)
const OP_OPTIONS = enumOptions(TWIN_2D_THRESHOLD_OPS, OP_LABELS)
const FIELD_OPTIONS = enumOptions(TWIN_2D_NODE_FIELDS, FIELD_LABELS)
const TEST_OPTIONS = enumOptions(TWIN_2D_FIELD_TESTS, TEST_LABELS)
const MODE_OPTIONS = enumOptions(TWIN_2D_HAS_MODES, MODE_LABELS)

const level = computed(() => props.depth ?? 0)

// ⚠ 超深那一档禁掉而不是从表里删掉：删了之后一份从别处导进来的深条件会让下拉显示成
// 空白，用户连「它现在是哪一档」都看不出来
const kindOptions = computed(() =>
  TWIN_2D_CONDITION_KINDS.map((value) => ({
    value,
    label: KIND_LABELS[value],
    disabled: value === 'not' && level.value >= MAX_NOT_DEPTH,
  })),
)

// ⚠ 各档取值一律在 script 里解开，不靠模板里的 v-if 收窄联合类型：模板收窄失手时
// typecheck 与 lint 双双放行，只在运行期读到 undefined
const state = computed<Twin2dState | null>(() => {
  const cond = props.modelValue
  return cond?.kind === 'state' ? cond.state : null
})

const statuses = computed<readonly Twin2dStatus[] | null>(() => {
  const cond = props.modelValue
  return cond?.kind === 'status' ? cond.in : null
})

const tag = computed<TagCond | null>(() => {
  const cond = props.modelValue
  return cond?.kind === 'tag' ? cond : null
})

const slot = computed<SlotCond | null>(() => {
  const cond = props.modelValue
  return cond?.kind === 'slot' ? cond : null
})

const has = computed<HasCond | null>(() => {
  const cond = props.modelValue
  return cond?.kind === 'has' ? cond : null
})

const field = computed<FieldCond | null>(() => {
  const cond = props.modelValue
  return cond?.kind === 'field' ? cond : null
})

const inner = computed<Twin2dCondition | null>(() => {
  const cond = props.modelValue
  return cond?.kind === 'not' ? cond.of : null
})

/** 一项都没有的名单；不每次现造一个，免得下游的输入框每帧白重播一次。 */
const NO_LIST: readonly string[] = Object.freeze([])

/** 名单那一格现在挂在哪一档上；`present` 一档不看名单，所以那时不摆。 */
const list = computed<readonly string[] | null>(() => {
  if (tag.value !== null) return tag.value.in
  if (has.value !== null) return has.value.slots
  return field.value?.test === 'in' ? field.value.in : null
})

const listValue = computed<readonly string[]>(() => list.value ?? NO_LIST)

const listLabel = computed(() => (has.value === null ? '名单' : '槽键'))

const listError = computed(() =>
  (list.value?.length ?? 1) === 0 ? NEED_LIST : '',
)

const needsSecond = computed(() => {
  const op = slot.value?.op
  return op === 'between' || op === 'outside'
})

function write(next: Twin2dCondition): void {
  emit('update:modelValue', next)
}

/**
 * 一档新条件；换成取反时把这一条收进去，配到一半的东西不白丢。
 * @param kind 目标档位
 * @param from 这一层现在这条条件
 */
function blankCondition(
  kind: Twin2dConditionKind,
  from: Twin2dCondition | null,
): Twin2dCondition {
  switch (kind) {
    case 'status':
      return { kind, in: ['alarm'] }
    case 'tag':
      return { kind, key: '', in: [] }
    case 'slot':
      return { kind, slot: '', op: 'gte', value: null, value2: null }
    case 'has':
      return { kind, slots: [], mode: 'any' }
    case 'field':
      return { kind, field: 'labelPos', test: 'in', in: [] }
    case 'not':
      return { kind, of: from ?? { kind: 'state', state: 'hover' } }
    default:
      return { kind: 'state', state: 'hover' }
  }
}

function writeKind(next: string): void {
  const kind = TWIN_2D_CONDITION_KINDS.find((item) => item === next)
  if (kind === undefined || kind === props.modelValue?.kind) return
  // ⚠ 下拉已经把超深那一档禁掉了，这里再拦一道：禁用态只挡鼠标，挡不住别的进来的取值
  if (kind === 'not' && level.value >= MAX_NOT_DEPTH) return
  write(blankCondition(kind, props.modelValue))
}

function writeState(next: string): void {
  const found = TWIN_2D_STATES.find((item) => item === next)
  if (found !== undefined) write({ kind: 'state', state: found })
}

/** 勾一个运行状态；按 `TWIN_2D_STATUSES` 的次序收，勾选顺序不影响文档序。 */
function toggleStatus(one: Twin2dStatus, on: boolean): void {
  const at = statuses.value
  if (at === null) return
  write({
    kind: 'status',
    in: TWIN_2D_STATUSES.filter((item) =>
      item === one ? on : at.includes(item),
    ),
  })
}

function writeTagKey(key: string): void {
  const at = tag.value
  if (at !== null) write({ ...at, key })
}

function writeSlot(patch: Partial<Omit<SlotCond, 'kind'>>): void {
  const at = slot.value
  if (at !== null) write({ ...at, ...patch })
}

function writeOp(next: string): void {
  const op = TWIN_2D_THRESHOLD_OPS.find((item) => item === next)
  if (op !== undefined) writeSlot({ op })
}

function writeMode(next: string): void {
  const at = has.value
  const mode = TWIN_2D_HAS_MODES.find((item) => item === next)
  if (at !== null && mode !== undefined) write({ ...at, mode })
}

function writeFieldName(next: string): void {
  const at = field.value
  const found = TWIN_2D_NODE_FIELDS.find((item) => item === next)
  if (at !== null && found !== undefined) write({ ...at, field: found })
}

function writeTest(next: string): void {
  const at = field.value
  const found = TWIN_2D_FIELD_TESTS.find((item) => item === next)
  if (at !== null && found !== undefined) write({ ...at, test: found })
}

/**
 * 换掉取反里面那一条；里面那条被清空时保留原样（取反没有「里面空着」这一档）。
 * @param next 里面那条的新内容
 */
function writeInner(next: Twin2dCondition | null): void {
  const at = inner.value
  if (at !== null) write({ kind: 'not', of: next ?? at })
}

/** 名单那一格：三档各写各的键。 */
function writeList(next: readonly string[]): void {
  const tagAt = tag.value
  const hasAt = has.value
  const fieldAt = field.value
  if (tagAt !== null) write({ ...tagAt, in: next })
  else if (hasAt !== null) write({ ...hasAt, slots: next })
  else if (fieldAt !== null) write({ ...fieldAt, in: next })
}
</script>

<template>
  <div class="flex flex-col gap-1.5" @focusout="emit('blur')">
    <DtButton
      v-if="modelValue === null"
      size="sm"
      variant="soft"
      intent="neutral"
      icon="plus"
      block
      data-test="cond-add"
      @click="write({ kind: 'state', state: 'hover' })"
    >
      加一条条件
    </DtButton>

    <template v-else>
      <div class="flex items-end gap-1">
        <DtSelect
          class="min-w-0 flex-1"
          :model-value="modelValue.kind"
          :options="kindOptions"
          label="条件"
          size="sm"
          data-test="cond-kind"
          @update:model-value="writeKind"
        />
        <DtButton
          v-if="required !== true"
          size="xs"
          variant="ghost"
          intent="danger"
          icon="trash"
          aria-label="不判条件"
          title="不判条件"
          data-test="cond-clear"
          @click="emit('update:modelValue', null)"
        />
      </div>

      <DtSelect
        v-if="state !== null"
        :model-value="state"
        :options="STATE_OPTIONS"
        label="交互态"
        size="sm"
        data-test="cond-state"
        @update:model-value="writeState"
      />

      <div v-if="statuses !== null" class="grid grid-cols-2 gap-1">
        <DtCheckbox
          v-for="one in TWIN_2D_STATUSES"
          :key="one"
          :model-value="statuses.includes(one)"
          :label="STATUS_LABELS[one]"
          :data-test="`cond-status-${one}`"
          @update:model-value="toggleStatus(one, $event)"
        />
      </div>

      <p
        v-if="statuses !== null && statuses.length === 0"
        class="text-xs text-state-danger"
        data-test="cond-status-empty"
      >
        {{ NEED_LIST }}
      </p>

      <DtInput
        v-if="tag !== null"
        :model-value="tag.key"
        label="标签键"
        placeholder="subtype"
        size="sm"
        :error="tag.key.trim() === '' ? NEED_KEY : ''"
        data-test="cond-tag-key"
        @update:model-value="writeTagKey"
      />

      <template v-if="slot !== null">
        <DtInput
          :model-value="slot.slot"
          label="槽键"
          placeholder="heat"
          size="sm"
          :error="slot.slot.trim() === '' ? NEED_SLOT : ''"
          data-test="cond-slot-key"
          @update:model-value="writeSlot({ slot: $event })"
        />
        <DtSelect
          :model-value="slot.op"
          :options="OP_OPTIONS"
          label="算子"
          size="sm"
          data-test="cond-op"
          @update:model-value="writeOp"
        />
        <div class="grid grid-cols-2 gap-1.5">
          <DtNumberInput
            :model-value="slot.value ?? undefined"
            label="界值"
            size="sm"
            :steppers="false"
            :error="slot.value === null ? NEED_BOUND : ''"
            data-test="cond-value"
            @update:model-value="writeSlot({ value: $event ?? null })"
          />
          <DtNumberInput
            v-if="needsSecond"
            :model-value="slot.value2 ?? undefined"
            label="另一界"
            size="sm"
            :steppers="false"
            :error="slot.value2 === null ? NEED_BOUND : ''"
            data-test="cond-value2"
            @update:model-value="writeSlot({ value2: $event ?? null })"
          />
        </div>
      </template>

      <DtSelect
        v-if="has !== null"
        :model-value="has.mode"
        :options="MODE_OPTIONS"
        label="判定"
        size="sm"
        data-test="cond-mode"
        @update:model-value="writeMode"
      />

      <template v-if="field !== null">
        <DtSelect
          :model-value="field.field"
          :options="FIELD_OPTIONS"
          label="字段"
          size="sm"
          data-test="cond-field"
          @update:model-value="writeFieldName"
        />
        <DtSelect
          :model-value="field.test"
          :options="TEST_OPTIONS"
          label="判据"
          size="sm"
          data-test="cond-test"
          @update:model-value="writeTest"
        />
      </template>

      <StringListField
        v-if="list !== null"
        :model-value="listValue"
        :label="listLabel"
        :error="listError"
        data-test="cond-list"
        @update:model-value="writeList"
      />

      <ConditionField
        v-if="inner !== null"
        :model-value="inner"
        :depth="level + 1"
        required
        data-test="cond-inner"
        @update:model-value="writeInner"
      />
    </template>
  </div>
</template>
