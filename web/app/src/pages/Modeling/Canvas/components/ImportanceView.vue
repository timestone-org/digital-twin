<script setup lang="ts">
/**
 * @fileoverview 特征重要性这一屏：按列名建键的那一份字典画成降序排行条
 * （设计规格 §5-23）。这些键是**列名**不是指标名，一律不查阈值表与单位表。
 *
 * ⚠ 恰好 0 分的列不摆成条：条长就是 0，警示色与斜纹在唯一会触发它们的场景里
 * 一个都看不见，读者只看到一条空轨道。树模型对没用上的列吐 0.0 是常态，这些
 * 列改成图下点名的一行字（规格 §2-P6）。
 */
import { DtNotice } from '@dt/ui'
import { computed } from 'vue'

import type { BarListItem } from '../scripts/barList'
import { grouped } from '../scripts/numbers'

import BarList from './BarList.vue'

const props = defineProps<{
  /** 列名 → 打乱那一列后掉的分。 */
  metrics: readonly (readonly [string, number | null])[]
}>()

// 排序时把「算不出来」放到最后：它不是 0，也不是最小的那个
const LAST = Number.NEGATIVE_INFINITY

/** 名字最多点这么多个，再多这一行字自己就读不成了。 */
const MAX_NAMES = 12

/** 降序：最重要的排在最上面（规格 §5-23）。 */
const sorted = computed(() =>
  [...props.metrics].sort(
    ([, left], [, right]) => (right ?? LAST) - (left ?? LAST),
  ),
)

/** 一分都没掉的那几列：模型压根没用上它们。 */
const unused = computed(() =>
  sorted.value.filter(([, value]) => value === 0).map(([name]) => name),
)

const rows = computed<BarListItem[]>(() =>
  sorted.value
    .filter(([, value]) => value !== 0)
    .map(([name, value]) =>
      // ⚠ 打乱反而变好 = 噪声列，是一条能直接照做的结论
      value !== null && value < 0
        ? { name, value, tone: 'dropped' as const }
        : { name, value },
    ),
)

/** 没用上的那几列点名；多到点不过来就补一句还有多少。 */
const unusedText = computed(() => {
  const names = unused.value
  if (names.length === 0) return ''
  const rest = names.length - MAX_NAMES
  const tail = rest > 0 ? `，另有 ${grouped(rest)} 列` : ''
  const head = `这 ${grouped(names.length)} 列打乱后一分都没掉，模型没用上：`
  return `${head}${names.slice(0, MAX_NAMES).join('、')}${tail}`
})

/** 一列都没剩下时，空态要说的是「全都没用上」而不是「没算出来」。 */
const emptyText = computed(() =>
  unused.value.length > 0
    ? '每一列打乱后都一分没掉：这个模型没有用上任何一列'
    : '这一步没有算出任何一列的重要性',
)
</script>

<template>
  <div class="dt-ml-importance">
    <BarList
      :items="rows"
      caption="把这一列打乱后掉的分：越长越重要；负值（斜纹）是打乱反而变好，那是噪声列"
      :empty-text="emptyText"
    />
    <p v-if="unusedText !== ''" class="dt-ml-importance__unused">
      {{ unusedText }}
    </p>
    <DtNotice intent="info">
      基线分没有随这份摘要带回来：同一个 0.12，在 R²=0.9 的模型上是砍掉 13% 的
      解释力，在 R²=0.2 上是砍掉 60%——没有基线分读不出这一层。
    </DtNotice>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-importance {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;

  &__unused {
    margin: -0.5rem 0 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
