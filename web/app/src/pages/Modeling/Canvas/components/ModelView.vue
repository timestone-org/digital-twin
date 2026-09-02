<script setup lang="ts">
/**
 * @fileoverview 一个已训练模型的结果视图：算法、特征列、超参、系数与权重条。
 *
 * ⚠ 「没训练出模型」与「摘要太大被截掉了系数」要分开说：后端在撑爆字节预算时
 * 会把拟合参数整个摘掉（`preview.py::_stripped`），把两者混作一处会让一个跑成功
 * 的模型在界面上被说成没训出来。
 */
import { DtNotice, DtTag } from '@dt/ui'
import { computed } from 'vue'

import { niceNumber } from '../scripts/numbers'
import type { ModelPreview } from '../scripts/preview'

const props = defineProps<{ preview: ModelPreview }>()

const TASK_LABELS: Record<string, string> = {
  regression: '回归',
  classification: '分类',
}

/** 可服务性：这一版能不能配到台账公式里去。 */
const SERVING = computed(() => {
  if (props.preview.servingChannel === 'json') {
    return { intent: 'success' as const, text: '可上线：拟合参数是纯 JSON' }
  }
  if (props.preview.servingChannel === 'binary') {
    return { intent: 'warning' as const, text: '二进制产物，本轮不可上线' }
  }
  return { intent: 'neutral' as const, text: '这一步不产出可上线的模型' }
})

/** 按权重绝对值从大到小排——用户想知道的是「哪几列说了算」。 */
const ranked = computed(() =>
  [...props.preview.coefficients].sort(
    (left, right) => Math.abs(right[1]) - Math.abs(left[1]),
  ),
)

const widest = computed(() =>
  Math.max(1, ...ranked.value.map(([, weight]) => Math.abs(weight))),
)

/**
 * 每根权重条画在哪。零线在正中，正权重往右长、负权重往左长。
 *
 * ⚠ 条子用 HTML 而不是 SVG：名字与数值要跟着条子对齐，还要能 `text-overflow`，
 * 用 SVG 就得自己算基线与截断。
 */
const bars = computed(() =>
  ranked.value.map(([key, weight]) => {
    const share = (Math.abs(weight) / widest.value) * 50
    return {
      key,
      weight,
      isMinus: weight < 0,
      left: `${weight >= 0 ? 50 : 50 - share}%`,
      width: `${share}%`,
    }
  }),
)
</script>

<template>
  <div class="dt-ml-model">
    <DtNotice v-if="props.preview.isFittedTrimmed" intent="info">
      这一步的结果摘要太大，拟合参数没有一起带回来；模型本身是训好的。
    </DtNotice>
    <DtNotice v-else-if="!props.preview.isFitted" intent="warning">
      这一步还没有训练出模型，下游用不了
    </DtNotice>
    <dl class="dt-ml-model__facts">
      <dt>算法</dt>
      <dd>{{ props.preview.algo }}</dd>
      <dt>任务</dt>
      <dd>{{ TASK_LABELS[props.preview.task] ?? props.preview.task }}</dd>
      <dt>目标列</dt>
      <dd>{{ props.preview.targetKey || '—' }}</dd>
      <dt>可服务性</dt>
      <dd>
        <DtTag :intent="SERVING.intent" size="sm">{{ SERVING.text }}</DtTag>
      </dd>
      <dt>特征列</dt>
      <dd class="dt-ml-model__keys">
        <DtTag
          v-for="key in props.preview.featureKeys"
          :key="key"
          intent="neutral"
          size="sm"
          mono
        >
          {{ key }}
        </DtTag>
        <span v-if="props.preview.featureKeys.length === 0">—</span>
      </dd>
    </dl>
    <template v-if="ranked.length > 0">
      <h4 class="dt-ml-model__title">
        各列的权重<span v-if="props.preview.intercept !== null">
          · 截距 {{ niceNumber(props.preview.intercept) }}</span
        >
      </h4>
      <ul class="dt-ml-model__weights">
        <li v-for="bar in bars" :key="bar.key">
          <code class="dt-ml-model__name">{{ bar.key }}</code>
          <span class="dt-ml-model__track">
            <span
              class="dt-ml-model__bar"
              :class="{ 'dt-ml-model__bar--minus': bar.isMinus }"
              :style="{ left: bar.left, width: bar.width }"
            />
          </span>
          <strong class="dt-ml-model__num">
            {{ niceNumber(bar.weight) }}
          </strong>
        </li>
      </ul>
    </template>
    <h4 class="dt-ml-model__title">超参</h4>
    <dl class="dt-ml-model__facts">
      <template v-for="[key, value] in props.preview.hyperParams" :key="key">
        <dt>{{ key }}</dt>
        <dd>{{ value }}</dd>
      </template>
    </dl>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-model {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  &__facts {
    display: grid;
    grid-template-columns: 7rem 1fr;
    gap: 0.375rem 0.75rem;
    margin: 0;
    font-size: var(--ctl-fs-md);

    dt {
      color: var(--text-secondary);
    }

    dd {
      margin: 0;
      color: var(--text-primary);
    }
  }

  &__keys {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  &__title {
    margin: 0;
    color: var(--text-title);
    font-size: var(--ctl-fs-sm);
  }

  &__weights {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      font-size: var(--ctl-hint-fs-sm);
    }
  }

  &__name {
    flex: none;
    width: 8rem;
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__track {
    position: relative;
    flex: 1;
    height: 1rem;
    min-width: 0;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);

    // 零线画在正中，条子从这儿往两边长
    &::before {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 50%;
      border-left: 1px dashed var(--border-strong);
      content: '';
    }
  }

  &__bar {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: var(--radius-sm);
    background: rgb(var(--accent-primary-rgb) / 0.75);

    &--minus {
      background: rgb(var(--state-warning-rgb) / 0.75);
    }
  }

  &__num {
    flex: none;
    width: 5rem;
    color: var(--text-title);
    font-family: var(--font-digit);
    text-align: right;
  }
}
</style>
