<script setup lang="ts">
/**
 * @fileoverview ① 区「这一步做了什么」的外壳：一句话 gist ＋ 参数 chips ＋
 * 行/列/格子的账（插槽，由块自己的画法画）＋ 告警。
 *
 * ⚠ 告警分两级：只有**会导致错误结论**的那几条才占一整行（规格 §11 的
 * R-24），其余口径说明进 gist 旁边的小问号。
 * ⚠ 那一整行还自己铺了底与边：`DtNotice` 本身只是一行彩色文字，压在一屏数字
 * 里会被整条略过，而这几句正是「不许被略过」的那几句。
 */
import { DtHelpTip, DtNotice, DtTag } from '@dt/ui'
import { computed, ref } from 'vue'

import type { StepChip } from '../scripts/stepSummary'
import {
  GIST_CHARS,
  MAX_CHIPS,
  stepAlertsOf,
  stepChipsOf,
} from '../scripts/stepSummary'

const props = withDefaults(
  defineProps<{
    /** 一句话结论。≤3 行，超了收起来。 */
    gist?: string
    /** 算子 code，决定那几条必须被看见的告警。 */
    operator?: string
    /** 运行时冻结的那份参数。 */
    config?: Record<string, unknown> | undefined
    /** 算子的 JSON Schema，只用来给 chips 取中文名与枚举文案。 */
    schema?: Record<string, unknown> | undefined
    /** 其余口径说明。⚠ 它们不占整行，合在一个小问号里。 */
    hints?: readonly string[] | undefined
  }>(),
  {
    gist: '',
    operator: '',
    config: undefined,
    schema: undefined,
    hints: () => [],
  },
)

const isOpen = ref(false)

const chips = computed<StepChip[]>(() =>
  stepChipsOf(props.config ?? {}, props.schema ?? {}),
)

const shownChips = computed(() =>
  isOpen.value ? chips.value : chips.value.slice(0, MAX_CHIPS),
)

const alerts = computed(() => stepAlertsOf(props.operator))

/** 合成一段的口径说明；一条都没有时那个小问号不摆。 */
const hintText = computed(() => (props.hints ?? []).join('；'))

const isFoldable = computed(
  () => chips.value.length > MAX_CHIPS || props.gist.length > GIST_CHARS,
)

const foldText = computed(() => {
  if (isOpen.value) return '收起'
  const rest = chips.value.length - MAX_CHIPS
  return rest > 0 ? `展开全部（还有 ${rest} 项参数）` : '展开全部'
})
</script>

<template>
  <section class="dt-ml-step">
    <p
      v-if="props.gist !== ''"
      class="dt-ml-step__gist"
      :class="{ 'dt-ml-step__gist--clamped': !isOpen }"
    >
      {{ props.gist }}
      <DtHelpTip
        v-if="hintText !== ''"
        :text="hintText"
        label="这一步的口径说明"
      />
    </p>
    <ul v-if="shownChips.length > 0" class="dt-ml-step__chips">
      <li v-for="chip in shownChips" :key="chip.key">
        <DtTag :intent="chip.isDefault ? 'neutral' : 'primary'">
          {{ chip.label }} {{ chip.value }}
        </DtTag>
      </li>
    </ul>
    <button
      v-if="isFoldable"
      type="button"
      class="dt-ml-step__fold"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
    >
      {{ foldText }}
    </button>
    <slot />
    <div v-for="one in alerts" :key="one" class="dt-ml-step__alert">
      <DtNotice intent="warning" icon="alert-triangle">{{ one }}</DtNotice>
    </div>
  </section>
</template>

<style scoped lang="scss">
.dt-ml-step {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  &__gist {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--ctl-hint-fs-md);
    line-height: 1.6;

    // 收起时只留三行：① 区再长就把「关键数字」推出首屏（规格 §3.2）
    &--clamped {
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
    }
  }

  &__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__fold {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent-primary);
    font-size: var(--ctl-hint-fs-sm);
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }
  }

  // ⚠ 自己铺底与边：DtNotice 只是一行彩色文字，在一屏数字里会被整条略过
  &__alert {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid rgba(var(--state-warning-rgb), 0.35);
    border-left-width: 3px;
    border-radius: var(--radius-md);
    background: rgba(var(--state-warning-rgb), 0.08);
  }
}
</style>
