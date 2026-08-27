<script setup lang="ts">
/**
 * @fileoverview 派生槽算式的编辑面：七档闭合算子，最多三层，逐层递归。
 *
 * ⚠ 深度上限在编辑器里**当场拦住**，不等归一化静默处理：第三层（`depth === 2`）只放得下
 *   槽位与常量，再嵌一层的话 `normalizeExpr` 会把那一枝判空，而列表档一项都不剩时
 *   整条算式跟着变 null——用户看到的是「我配的算式存了一次就没了」，且零报错。
 * ⚠ `ratio` 的分母 ≤ 0 时整式取空值（`ratioValue`），所以分母是个 ≤0 的常量时当场标红：
 *   给 0% 会让「没在跑」和「效率为零」在墙上长得一模一样。
 * ⚠ `first` / `sum` / `join` 的最后一项删不得：一项都不剩的列表档会被整条丢掉，
 *   于是这个槽悄悄降级成实时槽。
 * ⚠ `join` 的分隔符不 trim：`' · '` 里的空格是有意义的，trim 掉两个读数就贴在一起。
 * ⚠ 槽键为空的 `slot` 档会被整条丢弃，所以空键当场标红。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import { TWIN_2D_EXPR_KINDS, TWIN_2D_MAX_EXPR_DEPTH } from '@dt/twin2d'
import type { Twin2dExpr, Twin2dExprKind } from '@dt/twin2d'
import { DtButton, DtInput, DtNumberInput, DtSelect } from '@dt/ui'
import { computed } from 'vue'

type RatioExpr = Extract<Twin2dExpr, { kind: 'ratio' }>
type ScaleExpr = Extract<Twin2dExpr, { kind: 'scale' }>

const props = defineProps<{
  modelValue: Twin2dExpr | null
  /** 这一层在算式里的深度，根是 0；递归时逐层加一。 */
  depth?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [Twin2dExpr]
  blur: []
}>()

/** 只放得下叶子的那一层还能选哪两档。 */
const LEAF_KINDS: readonly Twin2dExprKind[] = ['slot', 'lit']

/** 换成比值档时的缺省倍数：比值多半是拿来出百分数的。 */
const PERCENT_SCALE = 100

/** 第三层的说明。 */
const LEAF_HINT =
  '算式最多三层：这一层只放得下槽位与写死值，再嵌一层落盘时整条会被丢掉'

/** 已经越界的那一层的说明。 */
const DEEP_HINT =
  '这一层超过了三层上限，落盘时整条算式会被丢掉——请在上一层删掉它'

/** 分母那一格一直摆着的说明。 */
const DEN_HINT =
  '分母 ≤ 0 时整式取空值：给 0% 会让「没在跑」和「效率为零」长得一样'

/** 分母写死成 ≤0 时的说明。 */
const DEN_ZERO = '这个分母是个 ≤ 0 的常量，这条算式永远取不到值'

/** 槽键为空时的说明。 */
const EMPTY_SLOT = '必填：没有槽键的这一档会被整条丢弃'

/** 最后一项删不得。 */
const LAST_ARG = '至少留一项：一项都不剩的列表档会被整条丢掉'

const KIND_LABELS: Readonly<Record<Twin2dExprKind, string>> = {
  slot: '取一个槽位',
  lit: '写死一个值',
  first: '取第一个有值的',
  ratio: '比值（分子 ÷ 分母 × 倍数）',
  sum: '求和',
  scale: '乘一个倍数',
  join: '拼接成文本',
}

/** 一项都没有的列表；不每次现造一个，免得下游白重画。 */
const NO_ARGS: readonly Twin2dExpr[] = Object.freeze([])

const level = computed(() => props.depth ?? 0)

const tooDeep = computed(() => level.value >= TWIN_2D_MAX_EXPR_DEPTH)

const leafOnly = computed(() => level.value === TWIN_2D_MAX_EXPR_DEPTH - 1)

function isLeaf(kind: Twin2dExprKind): boolean {
  return LEAF_KINDS.some((item) => item === kind)
}

// ⚠ 超深那几档禁掉而不是从表里删掉：删了之后一份从别处导进来的深算式会让下拉显示成
//   空白，用户连「它现在是哪一档」都看不出来，更谈不上把它改浅
const kindOptions = computed(() =>
  TWIN_2D_EXPR_KINDS.map((value) => ({
    value,
    label: KIND_LABELS[value],
    disabled: leafOnly.value && !isLeaf(value),
  })),
)

// ⚠ 各档取值一律在 script 里解开，不靠模板里的 v-if 收窄联合类型：模板收窄失手时
//   typecheck 与 lint 双双放行，只在运行期读到 undefined
const slotKey = computed<string | null>(() => {
  const expr = props.modelValue
  return expr?.kind === 'slot' ? expr.slot : null
})

const litValue = computed<number | string | null>(() => {
  const expr = props.modelValue
  return expr?.kind === 'lit' ? expr.value : null
})

const litIsText = computed(() => typeof litValue.value === 'string')

const ratio = computed<RatioExpr | null>(() => {
  const expr = props.modelValue
  return expr?.kind === 'ratio' ? expr : null
})

const scale = computed<ScaleExpr | null>(() => {
  const expr = props.modelValue
  return expr?.kind === 'scale' ? expr : null
})

const args = computed<readonly Twin2dExpr[]>(() => {
  const expr = props.modelValue
  if (expr === null) return NO_ARGS
  if (expr.kind === 'first' || expr.kind === 'sum' || expr.kind === 'join') {
    return expr.of
  }
  return NO_ARGS
})

const joinSep = computed<string | null>(() => {
  const expr = props.modelValue
  return expr?.kind === 'join' ? expr.sep : null
})

const denZero = computed(() => {
  const den = ratio.value?.den
  return den?.kind === 'lit' && typeof den.value === 'number' && den.value <= 0
})

function write(next: Twin2dExpr): void {
  emit('update:modelValue', next)
}

/**
 * 一档新算式；换成组合档时把这一条收成第一个操作数，配到一半的东西不白丢。
 * @param kind 目标算子
 * @param from 这一层现在这条算式
 */
function blankExpr(kind: Twin2dExprKind, from: Twin2dExpr | null): Twin2dExpr {
  const one: Twin2dExpr = from ?? { kind: 'lit', value: 0 }
  switch (kind) {
    case 'slot':
      return { kind, slot: '' }
    case 'first':
    case 'sum':
      return { kind, of: [one] }
    case 'join':
      return { kind, of: [one], sep: ' ' }
    case 'ratio':
      return {
        kind,
        num: one,
        den: { kind: 'lit', value: 1 },
        scale: PERCENT_SCALE,
      }
    case 'scale':
      return { kind, of: one, by: 1 }
    default:
      return { kind: 'lit', value: 0 }
  }
}

function writeKind(next: string): void {
  const kind = TWIN_2D_EXPR_KINDS.find((item) => item === next)
  if (kind === undefined || kind === props.modelValue?.kind) return
  // ⚠ 下拉已经把这几档禁掉了，这里再拦一道：禁用态只挡鼠标，挡不住别的进来的取值
  if (leafOnly.value && !isLeaf(kind)) return
  write(blankExpr(kind, props.modelValue))
}

function writeSlot(slot: string): void {
  if (slotKey.value !== null) write({ kind: 'slot', slot })
}

/** 常量两形：数与文本。换形时不带值过去——`'0'` 与 0 在求值层是两回事。 */
function writeLitText(on: boolean): void {
  if (litValue.value !== null) write({ kind: 'lit', value: on ? '' : 0 })
}

function writeLit(value: number | string): void {
  if (litValue.value !== null) write({ kind: 'lit', value })
}

function writeRatio(patch: Partial<Omit<RatioExpr, 'kind'>>): void {
  const at = ratio.value
  if (at !== null) write({ ...at, ...patch })
}

function writeScale(patch: Partial<Omit<ScaleExpr, 'kind'>>): void {
  const at = scale.value
  if (at !== null) write({ ...at, ...patch })
}

function writeArgs(of: readonly Twin2dExpr[]): void {
  const expr = props.modelValue
  if (expr === null) return
  if (expr.kind === 'first' || expr.kind === 'sum')
    write({ kind: expr.kind, of })
  else if (expr.kind === 'join') write({ kind: 'join', of, sep: expr.sep })
}

function patchArg(order: number, next: Twin2dExpr): void {
  writeArgs(args.value.map((item, seat) => (seat === order ? next : item)))
}

function addArg(): void {
  writeArgs([...args.value, { kind: 'lit', value: 0 }])
}

function removeArg(order: number): void {
  writeArgs(args.value.filter((_, seat) => seat !== order))
}

function writeSep(sep: string): void {
  // ⚠ 不 trim：`' · '` 里的空格正是分隔符本身
  const expr = props.modelValue
  if (expr?.kind === 'join') write({ kind: 'join', of: expr.of, sep })
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <p
      v-if="tooDeep"
      class="text-xs text-state-danger"
      data-test="expr-too-deep"
    >
      {{ DEEP_HINT }}
    </p>

    <template v-else-if="modelValue === null">
      <DtButton
        size="sm"
        variant="soft"
        intent="neutral"
        icon="plus"
        block
        data-test="expr-add"
        @click="write({ kind: 'lit', value: 0 })"
      >
        加一条算式
      </DtButton>
    </template>

    <template v-else>
      <DtSelect
        :model-value="modelValue.kind"
        :options="kindOptions"
        label="算子"
        size="sm"
        data-test="expr-kind"
        @update:model-value="writeKind"
      />

      <p
        v-if="leafOnly"
        class="text-xs text-text-disabled"
        data-test="expr-leaf-hint"
      >
        {{ LEAF_HINT }}
      </p>

      <DtInput
        v-if="slotKey !== null"
        :model-value="slotKey"
        label="槽键"
        placeholder="heat"
        size="sm"
        :error="slotKey.trim() === '' ? EMPTY_SLOT : ''"
        data-test="expr-slot"
        @update:model-value="writeSlot"
      />

      <template v-if="litValue !== null">
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          :pressed="litIsText"
          data-test="expr-lit-text"
          @click="writeLitText(!litIsText)"
        >
          当成文本
        </DtButton>
        <DtInput
          v-if="litIsText"
          :model-value="String(litValue)"
          label="写死的文本"
          size="sm"
          data-test="expr-lit-string"
          @update:model-value="writeLit"
        />
        <DtNumberInput
          v-else
          :model-value="Number(litValue)"
          label="写死的数"
          size="sm"
          :steppers="false"
          data-test="expr-lit-number"
          @update:model-value="writeLit($event ?? 0)"
        />
      </template>

      <div v-if="ratio !== null" class="flex flex-col gap-1.5">
        <p class="text-xs text-text-secondary">分子</p>
        <ExprEditor
          :model-value="ratio.num"
          :depth="level + 1"
          @update:model-value="writeRatio({ num: $event })"
          @blur="emit('blur')"
        />
        <p class="text-xs text-text-secondary">分母</p>
        <ExprEditor
          :model-value="ratio.den"
          :depth="level + 1"
          @update:model-value="writeRatio({ den: $event })"
          @blur="emit('blur')"
        />
        <p
          class="text-xs"
          :class="denZero ? 'text-state-danger' : 'text-text-disabled'"
          data-test="expr-den-hint"
        >
          {{ denZero ? DEN_ZERO : DEN_HINT }}
        </p>
        <DtNumberInput
          :model-value="ratio.scale"
          label="倍数"
          size="sm"
          :steppers="false"
          hint="100 = 出百分数"
          data-test="expr-ratio-scale"
          @update:model-value="writeRatio({ scale: $event ?? 1 })"
        />
      </div>

      <div v-if="scale !== null" class="flex flex-col gap-1.5">
        <ExprEditor
          :model-value="scale.of"
          :depth="level + 1"
          @update:model-value="writeScale({ of: $event })"
          @blur="emit('blur')"
        />
        <DtNumberInput
          :model-value="scale.by"
          label="乘以"
          size="sm"
          :steppers="false"
          data-test="expr-scale-by"
          @update:model-value="writeScale({ by: $event ?? 1 })"
        />
      </div>

      <div
        v-for="(item, order) in args"
        :key="`arg-${order}`"
        class="flex items-start gap-1"
        :data-test="`expr-arg-${order}`"
      >
        <ExprEditor
          class="min-w-0 flex-1"
          :model-value="item"
          :depth="level + 1"
          @update:model-value="patchArg(order, $event)"
          @blur="emit('blur')"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="danger"
          icon="trash"
          :disabled="args.length <= 1"
          :aria-label="args.length <= 1 ? LAST_ARG : '删掉这一项'"
          :title="args.length <= 1 ? LAST_ARG : '删掉这一项'"
          :data-test="`expr-arg-remove-${order}`"
          @click="removeArg(order)"
        />
      </div>

      <DtButton
        v-if="args.length > 0"
        size="xs"
        variant="ghost"
        intent="neutral"
        icon="plus"
        data-test="expr-arg-add"
        @click="addArg"
      >
        加一项
      </DtButton>

      <DtInput
        v-if="joinSep !== null"
        :model-value="joinSep"
        label="分隔符"
        placeholder="· "
        size="sm"
        hint="空格是有意义的，不会被去掉"
        data-test="expr-sep"
        @update:model-value="writeSep"
      />
    </template>
  </div>
</template>
