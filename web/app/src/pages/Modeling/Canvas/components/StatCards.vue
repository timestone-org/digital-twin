<script setup lang="ts">
/**
 * @fileoverview ② 区「关键数字」：4–8 张指标卡，每卡最小 12rem。
 *
 * ⚠ 只有有公认好坏线的那几个指标才三档染色（规格 §2-P3）：MAE / RMSE / 残差
 * 统计 / 置换重要性跟着目标列的量纲走，替它们拍一个颜色就是替用户下结论。
 * ⚠ 算不出来的写「无定义」不写 0，且把那条口径说明直接摊在卡片上——藏进小
 * 问号之后，用户看到的只是一个说不清为什么的空格（规格 §2-P4）。
 */
import { DtCard, DtDigits, DtHelpTip, DtTag } from '@dt/ui'
import { computed } from 'vue'

import type { MetricSpace } from '../scripts/metricBands'
import type { StatItem } from '../scripts/statCards'
import { statCardsMore, statCardsOf } from '../scripts/statCards'

const props = withDefaults(
  defineProps<{
    items: readonly StatItem[]
    /** 键是后端定死的指标名还是列名。列名档一律不查阈值表与单位表。 */
    space?: MetricSpace
  }>(),
  { space: 'metric' },
)

const cards = computed(() => statCardsOf(props.items, props.space))
const moreText = computed(() => statCardsMore(props.items))
</script>

<template>
  <div v-if="cards.length > 0" class="dt-ml-stats">
    <ul class="dt-ml-stats__grid">
      <li v-for="card in cards" :key="card.key">
        <DtCard padding="sm">
          <p class="dt-ml-stats__name">
            {{ card.label }}
            <DtHelpTip
              v-if="card.hint !== '' && !card.isUndefined"
              :text="card.hint"
              :label="`${card.label} 的口径`"
            />
          </p>
          <p class="dt-ml-stats__read">
            <DtDigits
              class="dt-ml-stats__value"
              :class="{ 'dt-ml-stats__value--none': card.isUndefined }"
              :value="card.text"
            />
            <span v-if="card.unit !== ''" class="dt-ml-stats__unit">{{
              card.unit
            }}</span>
            <DtTag v-if="card.word !== ''" :intent="card.intent">
              {{ card.word }}
            </DtTag>
          </p>
          <p
            v-if="card.isUndefined && card.hint !== ''"
            class="dt-ml-stats__why"
          >
            {{ card.hint }}
          </p>
        </DtCard>
      </li>
    </ul>
    <p v-if="moreText !== ''" class="dt-ml-stats__more">{{ moreText }}</p>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-stats {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  &__grid {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__name {
    display: flex;
    gap: 0.25rem;
    align-items: center;
    margin: 0 0 0.25rem;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__read {
    display: flex;
    gap: 0.375rem;
    align-items: baseline;
    margin: 0;
  }

  &__value {
    color: var(--text-title);
    font-family: var(--font-digit);
    font-size: 1.375rem;
    font-weight: 600;

    // 无定义不是一个读数：它跟旁边那些真数字用同一号字会被当成算出来了
    &--none {
      color: var(--text-secondary);
      font-size: 1rem;
      font-weight: 500;
    }
  }

  &__unit {
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__why {
    margin: 0.25rem 0 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
    line-height: 1.5;
  }

  &__more {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
