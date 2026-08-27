<script setup lang="ts">
/**
 * @fileoverview 槽位表的编辑面：键、显示名、两档来源（实时 / 派生）、数据类型、单位、
 * 精度、格式档、取值映射、占位符与主读数标记。
 *
 * ⚠ `key` 是**寻址键**：`txt{kind:'slot'}` 图元、变体条件与派生算式都按它取值，改名
 *   等于换一个槽——引用它的那几处会一起落空，而三处都零报错。所以键走草稿、失焦才落，
 *   并把「现在有几处引用着」摆在旁边（见 `useKeyDrafts`）。
 * ⚠ 换到派生那一档时**当场给一条算式**：`normalizeSlot` 见到 `derived` 而算式为 null
 *   会把它降级成 `live`，于是「我明明选了派生」在存一次之后自己变了回去。
 * ⚠ 算式存不存得下去只借 `normalizeExpr` 一把尺，不在这里另写一条判据：另写的一份
 *   一旦比它松，面板上不标红而落盘时整条降级，两边说的不是一回事。
 * ⚠ 取值映射的键是**字符串**：JSON 的键永远是字符串，标成数字时 `Object.entries` 出来
 *   的键与数值读数比较会静默不相等。映射命中时直接出文案，不再走单位与精度。
 * ⚠ 映射框逐键解析，但框里留用户敲的原文：不留的话正打到一半的 `1 =` 会被整行丢掉，
 *   等号后面永远打不出第一个字。失焦时把框拨回文档里的值。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import {
  TWIN_2D_SLOT_KINDS,
  TWIN_2D_VALUE_FORMATS,
  normalizeExpr,
} from '@dt/twin2d'
import type { Twin2dSlot, Twin2dSlotKind, Twin2dValueFormat } from '@dt/twin2d'
import { BINDING_DATA_TYPES } from '@dt/contracts'
import type { BindingDataType } from '@dt/contracts'
import {
  DtButton,
  DtCheckbox,
  DtEmpty,
  DtInput,
  DtNumberInput,
  DtSelect,
  DtTextarea,
} from '@dt/ui'
import { computed, ref, watch } from 'vue'

import { useKeyDrafts } from '../../scripts/useKeyDrafts'
import ExprEditor from './ExprEditor.vue'

const props = defineProps<{
  modelValue: readonly Twin2dSlot[]
  /**
   * 每个槽键现在被多少处引用（图元、条件、算式）；不给就只给一句通用提示。
   * ⚠ 0 与「不给」是两回事：前者说得出「这个槽还没人用，改名是安全的」。
   */
  usage?: Readonly<Record<string, number>>
}>()

const emit = defineEmits<{
  'update:modelValue': [readonly Twin2dSlot[]]
  blur: []
}>()

/** 新槽键的前缀；末位跟着表里现有的条数走。 */
const SLOT_PREFIX = 'slot'

/** 槽位占位符缺省，与 `TWIN_2D_DEFAULT_PLACEHOLDER` 逐字相同。 */
const DEFAULT_PLACEHOLDER = '—'

/** 精度上限，与 `normalizeSlot` 的夹取逐字相同。 */
const PRECISION_RANGE = { min: 0, max: 6, step: 1 }

/** 派生槽的算式落不了盘时的说明。 */
const EXPR_DROP_HINT = '这条算式存不下去，落盘时这个槽会降级成实时槽'

/** 改名落不下去时的两句说明。 */
const KEY_MESSAGES = {
  empty: '槽键不能为空：没有键的槽位会被整条丢掉',
  taken: '这个键已经被另一个槽位占着，同键只会留下最先那一条',
}

/** 一行一条映射。 */
const ENUM_LINE = /\r?\n/

const KIND_LABELS: Readonly<Record<Twin2dSlotKind, string>> = {
  live: '实时（成一行绑定）',
  derived: '派生（由算式得出）',
}

const TYPE_LABELS: Readonly<Record<BindingDataType, string>> = {
  number: '数值',
  boolean: '布尔',
  string: '文本',
  enum: '枚举',
}

const FORMAT_LABELS: Readonly<Record<Twin2dValueFormat, string>> = {
  auto: '自动（按精度）',
  kwhShort: '压缩（12k）',
  grouped: '千分位',
  trim2: '去尾随零',
}

const KIND_OPTIONS = TWIN_2D_SLOT_KINDS.map((value) => ({
  value,
  label: KIND_LABELS[value],
}))

const TYPE_OPTIONS = BINDING_DATA_TYPES.map((value) => ({
  value,
  label: TYPE_LABELS[value],
}))

const FORMAT_OPTIONS = TWIN_2D_VALUE_FORMATS.map((value) => ({
  value,
  label: FORMAT_LABELS[value],
}))

/** 面板上的一行：一条槽位，加上派生那一档已经解出来的算式与它存不存得下去。 */
interface Twin2dSlotRow {
  slot: Twin2dSlot
  /** 派生那一档的算式；不是这一档时为 null。 */
  expr: Twin2dSlot['expr']
  /** 这条算式落不了盘的说明；落得下去时是空串。 */
  exprError: string
}

/** 每一行取值映射框里的原文；只在用户正改这一格时存在。 */
const enumDrafts = ref<Record<string, string>>({})

/** 焦点还在本控件里；在里面时不拿文档里的值去盖用户正敲着的那半截。 */
const focused = ref(false)

const drafts = useKeyDrafts(
  () => props.modelValue.map((slot) => slot.key),
  KEY_MESSAGES,
)

const rows = computed<readonly Twin2dSlotRow[]>(() =>
  props.modelValue.map((slot) => {
    const expr = slot.kind === 'derived' ? slot.expr : null
    return {
      slot,
      expr,
      exprError:
        slot.kind === 'derived' && normalizeExpr(slot.expr) === null
          ? EXPR_DROP_HINT
          : '',
    }
  }),
)

watch(
  () => props.modelValue,
  () => {
    if (!focused.value) {
      drafts.reset()
      enumDrafts.value = {}
    }
  },
)

function onFocusIn(): void {
  focused.value = true
}

function onFocusOut(): void {
  focused.value = false
  enumDrafts.value = {}
  emit('blur')
}

function write(next: readonly Twin2dSlot[]): void {
  emit('update:modelValue', next)
}

/**
 * 改一条槽位的若干字段。
 * @param key 这一条的键
 * @param patch 要覆盖的字段
 */
function patchSlot(key: string, patch: Partial<Omit<Twin2dSlot, 'key'>>): void {
  write(
    props.modelValue.map((slot) =>
      slot.key === key ? { ...slot, ...patch } : slot,
    ),
  )
}

/**
 * 落定一次改名；改不动时草稿自己清掉、框拨回文档里的键。
 * @param key 这一条现在的键
 */
function commitKey(key: string): void {
  const next = drafts.commit(key)
  if (next === null) return
  write(
    props.modelValue.map((slot) =>
      slot.key === key ? { ...slot, key: next } : slot,
    ),
  )
}

/**
 * 改键会影响什么。
 * @param key 这一条的键
 */
function keyHint(key: string): string {
  const count = props.usage?.[key]
  if (count === undefined) return '图元、条件与算式都按这个键取值'
  if (count === 0) return '还没有地方引用这个槽，改键是安全的'
  return `有 ${count} 处引用着这个槽，改键会让它们一起落空`
}

/**
 * 换来源档；派生那一档当场给一条常量算式，落地就有值。
 * @param key 这一条的键
 * @param next 下拉给出的取值
 */
function writeKind(key: string, next: string): void {
  const kind = TWIN_2D_SLOT_KINDS.find((item) => item === next)
  if (kind === undefined) return
  if (kind === 'derived') {
    patchSlot(key, { kind, expr: { kind: 'lit', value: 0 } })
  } else patchSlot(key, { kind, expr: null })
}

function writeType(key: string, next: string): void {
  const dataType = BINDING_DATA_TYPES.find((item) => item === next)
  if (dataType !== undefined) patchSlot(key, { dataType })
}

function writeFormat(key: string, next: string): void {
  const format = TWIN_2D_VALUE_FORMATS.find((item) => item === next)
  if (format !== undefined) patchSlot(key, { format })
}

/** 映射表 → 框里的文本，一行一条。 */
function enumLines(map: Readonly<Record<string, string>>): string {
  return Object.entries(map)
    .map(([key, text]) => `${key} = ${text}`)
    .join('\n')
}

/**
 * 框里的文本 → 映射表；没有等号、空键与空文案的行逐行丢弃，同键留最先那一条。
 * ⚠ 用 Map 收：直接往对象字面量上赋 `__proto__` 这类键会改到原型而不是加一个属性。
 * @param raw 框里的原文
 */
function parseEnumLines(raw: string): Record<string, string> {
  const kept = new Map<string, string>()
  for (const line of raw.split(ENUM_LINE)) {
    const at = line.indexOf('=')
    if (at < 0) continue
    const key = line.slice(0, at).trim()
    const text = line.slice(at + 1).trim()
    if (key === '' || text === '' || kept.has(key)) continue
    kept.set(key, text)
  }
  return Object.fromEntries(kept)
}

function enumTextOf(slot: Twin2dSlot): string {
  return enumDrafts.value[slot.key] ?? enumLines(slot.enumMap)
}

function onEnumMap(key: string, raw: string): void {
  enumDrafts.value = { ...enumDrafts.value, [key]: raw }
  patchSlot(key, { enumMap: parseEnumLines(raw) })
}

/** 新槽键：末位跟着表里现有的条数走，撞上了往后顺延。 */
function freshKey(): string {
  const taken = new Set(props.modelValue.map((slot) => slot.key))
  let order = taken.size + 1
  while (taken.has(`${SLOT_PREFIX}${order}`)) order += 1
  return `${SLOT_PREFIX}${order}`
}

function addSlot(): void {
  write([
    ...props.modelValue,
    {
      key: freshKey(),
      label: '',
      kind: 'live',
      dataType: 'number',
      unit: '',
      precision: null,
      format: 'auto',
      enumMap: {},
      placeholder: DEFAULT_PLACEHOLDER,
      primary: false,
      expr: null,
    },
  ])
}

function removeSlot(key: string): void {
  write(props.modelValue.filter((slot) => slot.key !== key))
}
</script>

<template>
  <div
    class="flex flex-col gap-1.5"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <DtEmpty
      v-if="modelValue.length === 0"
      size="inline"
      title="还没有槽位"
      hint="一个槽位就是图上一处读数；实时槽会各成一行绑定。"
      data-test="slot-empty"
    />

    <div
      v-for="row in rows"
      :key="row.slot.key"
      class="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface-sunken p-2"
      :data-test="`slot-row-${row.slot.key}`"
    >
      <div class="flex items-end gap-1" @focusout="commitKey(row.slot.key)">
        <DtInput
          class="min-w-0 flex-1"
          :model-value="drafts.textOf(row.slot.key)"
          label="槽键"
          size="sm"
          :hint="keyHint(row.slot.key)"
          :error="drafts.errorOf(row.slot.key)"
          :data-test="`slot-key-${row.slot.key}`"
          @update:model-value="drafts.edit(row.slot.key, $event)"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="danger"
          icon="trash"
          aria-label="删除这个槽位"
          title="删除这个槽位"
          :data-test="`slot-remove-${row.slot.key}`"
          @click="removeSlot(row.slot.key)"
        />
      </div>

      <div class="grid grid-cols-2 gap-1.5">
        <DtInput
          :model-value="row.slot.label"
          label="显示名"
          placeholder="供热量"
          size="sm"
          :data-test="`slot-label-${row.slot.key}`"
          @update:model-value="patchSlot(row.slot.key, { label: $event })"
        />
        <DtSelect
          :model-value="row.slot.kind"
          :options="KIND_OPTIONS"
          label="来源"
          size="sm"
          :data-test="`slot-kind-${row.slot.key}`"
          @update:model-value="writeKind(row.slot.key, $event)"
        />
      </div>

      <div class="grid grid-cols-2 gap-1.5">
        <DtSelect
          :model-value="row.slot.dataType"
          :options="TYPE_OPTIONS"
          label="数据类型"
          size="sm"
          :data-test="`slot-type-${row.slot.key}`"
          @update:model-value="writeType(row.slot.key, $event)"
        />
        <DtSelect
          :model-value="row.slot.format"
          :options="FORMAT_OPTIONS"
          label="格式档"
          size="sm"
          :data-test="`slot-format-${row.slot.key}`"
          @update:model-value="writeFormat(row.slot.key, $event)"
        />
      </div>

      <div class="grid grid-cols-2 gap-1.5">
        <DtInput
          :model-value="row.slot.unit"
          label="单位"
          placeholder="kWh"
          size="sm"
          :data-test="`slot-unit-${row.slot.key}`"
          @update:model-value="patchSlot(row.slot.key, { unit: $event })"
        />
        <DtNumberInput
          :model-value="row.slot.precision ?? undefined"
          :range="PRECISION_RANGE"
          label="小数位"
          size="sm"
          :steppers="false"
          hint="留空 = 整数直出、小数一位"
          :data-test="`slot-precision-${row.slot.key}`"
          @update:model-value="
            patchSlot(row.slot.key, { precision: $event ?? null })
          "
        />
      </div>

      <DtInput
        :model-value="row.slot.placeholder"
        label="占位符"
        :placeholder="DEFAULT_PLACEHOLDER"
        size="sm"
        :data-test="`slot-placeholder-${row.slot.key}`"
        @update:model-value="patchSlot(row.slot.key, { placeholder: $event })"
      />

      <DtTextarea
        :model-value="enumTextOf(row.slot)"
        label="取值映射"
        placeholder="1 = 运行"
        hint="一行一条；命中时直接显示文案，不再走单位与精度"
        size="sm"
        mono
        :rows="2"
        :data-test="`slot-enum-${row.slot.key}`"
        @update:model-value="onEnumMap(row.slot.key, $event)"
      />

      <DtCheckbox
        :model-value="row.slot.primary"
        label="主读数"
        :data-test="`slot-primary-${row.slot.key}`"
        @update:model-value="patchSlot(row.slot.key, { primary: $event })"
      />

      <div v-if="row.expr !== null" class="flex flex-col gap-1">
        <p
          v-if="row.exprError !== ''"
          class="text-xs text-state-danger"
          :data-test="`slot-expr-error-${row.slot.key}`"
        >
          {{ row.exprError }}
        </p>
        <ExprEditor
          :model-value="row.expr"
          :data-test="`slot-expr-${row.slot.key}`"
          @update:model-value="patchSlot(row.slot.key, { expr: $event })"
          @blur="emit('blur')"
        />
      </div>
    </div>

    <DtButton
      size="sm"
      variant="soft"
      intent="neutral"
      icon="plus"
      block
      data-test="slot-add"
      @click="addSlot"
    >
      新增一个槽位
    </DtButton>
  </div>
</template>
