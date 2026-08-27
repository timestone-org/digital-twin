<script lang="ts">
/**
 * @fileoverview 卡片里的一格：段序固定的四段——① 标签 ② 读数 + 单位 ③ 涨跌块 ④ 状态点，
 * 外加两种画法的图标（右上角标 / 图标容器）。网格里的一格是纵向堆叠，段序固定就够了，
 * 不必像 info-list 的行那样声明式编排（MODULE_INFO_CARD_DESIGN §4.1）。
 * ⚠ 标签位置的类名只在标签真渲染时才挂：无标签时挂 `label-left` 会多出一列空网格
 * 与一个列间距，令读数偏移几像素——没人会把它当 bug 报上来。
 */
import type { CellState } from './cells'

/**
 * 读数四档各自的修饰类。
 * ⚠ 四档的占位符是同一个字，屏上全靠这几个类给的颜色与透明度分开；类名一处写死而不是
 * 模板现拼，是因为拼错了既不报错也不生效。
 */
const STATE_CLASS: Record<CellState, string> = {
  ok: '',
  pending: 'ic-value--pending',
  error: 'ic-value--error',
  unbound: 'ic-value--unbound',
}
</script>

<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'

import type { CardCell } from './cells'
import type { CardLook } from './look'

const props = defineProps<{ cell: CardCell; look: CardLook }>()

const emit = defineEmits<{ pick: [value: string] }>()

/** 右上角标那一档只画图，取不到素材图就退回 emoji。 */
const cornerSrc = computed(() =>
  props.look.icon.mode === 'corner' ? props.cell.icon : '',
)

const emoji = computed(() =>
  props.look.icon.mode === 'corner' && props.cell.icon === ''
    ? props.cell.emoji
    : '',
)

/** ⚠ 图与 emoji 都空时整个容器不画：留下来就是一个空圈，看着像素材坏了。 */
const hasBadge = computed(
  () =>
    props.look.icon.mode === 'badge' &&
    (props.cell.icon !== '' || props.cell.emoji !== ''),
)

const hasLabel = computed(() => props.cell.label !== '')

/** 有内容才画的涨跌块；⚠ 取成本地名字模板里才判得了空。 */
const compare = computed(() => props.cell.compare)

const cellClasses = computed(() => [
  ...props.look.classes,
  hasLabel.value ? `ic-cell--label-${props.look.labelPlace}` : '',
  { 'ic-cell--pick': props.cell.emitValue !== '' },
])

/** 块级变量也摊在格上：一格因此能脱开容器单独挂载，观感与在墙上一模一样。 */
const cellStyle = computed<CSSProperties>(() => ({
  ...props.look.vars,
  ...props.cell.vars,
}))

const labelClasses = computed(() => [
  'ic-label',
  { 'ic-label--hit': props.cell.labelIsHit },
])

const valueClasses = computed(() => [
  'ic-value',
  STATE_CLASS[props.cell.state],
  {
    'ic-value--gradient': props.cell.gradient,
    'ic-value--plain': !props.cell.digit,
    'ic-value--blink': props.cell.blink,
  },
])

/** 没有值的那一句话；有值时给 undefined，鼠标停上去不该冒出一个空提示。 */
const valueTitle = computed(() =>
  props.cell.reason === '' ? undefined : props.cell.reason,
)

/**
 * 点这一格。
 * ⚠ 吞冒泡是**有条件**的：配了联动值就吞（否则同一次点击会再被「整块可点」兜底
 * 抛一个没有 value 的 click，toggle 类动作当场自我抵消）；没配就放它上去。
 * @param event 原生点击事件
 */
function onPick(event: MouseEvent): void {
  if (props.cell.emitValue === '') return
  event.stopPropagation()
  emit('pick', props.cell.emitValue)
}
</script>

<template>
  <div class="ic-cell" :class="cellClasses" :style="cellStyle" @click="onPick">
    <img
      v-if="cornerSrc !== ''"
      class="ic-corner"
      :src="cornerSrc"
      alt=""
      aria-hidden="true"
      loading="lazy"
    />
    <i v-else-if="emoji !== ''" class="ic-corner ic-corner--emoji">{{
      emoji
    }}</i>
    <span v-if="hasBadge" class="ic-badge" aria-hidden="true">
      <img
        v-if="cell.icon !== ''"
        class="ic-badge__img"
        :src="cell.icon"
        alt=""
        loading="lazy"
      />
      <template v-else>{{ cell.emoji }}</template>
    </span>
    <div class="ic-text">
      <span v-if="hasLabel" :class="labelClasses">{{ cell.label }}</span>
      <span class="ic-read">
        <span :class="valueClasses" :title="valueTitle">{{ cell.text }}</span>
        <i v-if="cell.unit !== ''" class="ic-unit">{{ cell.unit }}</i>
      </span>
      <span v-if="compare !== null" class="ic-compare">
        <span class="ic-compare__arrow" aria-hidden="true">{{
          compare.arrow
        }}</span>
        <span class="ic-compare__delta">{{ compare.text }}</span>
        <i v-if="compare.label !== ''" class="ic-compare__label">{{
          compare.label
        }}</i>
      </span>
    </div>
    <i
      v-if="cell.dot !== null"
      class="ic-dot"
      role="img"
      :aria-label="cell.dot.text"
      :title="cell.dot.text"
    />
  </div>
</template>

<style scoped lang="scss">
@use './variants';
</style>
