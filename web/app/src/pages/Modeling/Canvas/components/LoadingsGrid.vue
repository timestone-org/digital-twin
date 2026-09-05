<script setup lang="ts">
/**
 * @fileoverview 载荷格：一行一条主成分轴、一列一个原列，方块面积 = 载荷绝对值。
 *
 * ⚠ 载荷有正有负、零在中间，不能用顺序色阶：那会把 −0.62 与 +0.02 画成同一个
 * 深浅。这里用面积编大小、空心编负号，颜色只是第三重（规格 §2-P6）。
 * ⚠ 混淆矩阵那张 `MatrixTable` 接不了这份数据：它按方阵算召回率与精确率，行列
 * 必须是同一组类目，而载荷是 K×J 的长方阵。
 */
import type { LoadingsView } from '../scripts/structureParts'

const props = defineProps<{ view: LoadingsView }>()
</script>

<template>
  <figure class="dt-ml-loadings">
    <svg :viewBox="props.view.viewBox" role="img" aria-label="载荷矩阵">
      <g class="dt-ml-loadings__rows">
        <text
          v-for="one in props.view.rowLabels"
          :key="one.key"
          :x="one.x"
          :y="one.y"
        >
          {{ one.text }}
          <title>{{ one.full }}</title>
        </text>
      </g>
      <g class="dt-ml-loadings__cols">
        <text
          v-for="one in props.view.columnLabels"
          :key="one.key"
          :x="one.x"
          :y="one.y"
          :transform="`rotate(-45 ${one.x} ${one.y})`"
        >
          {{ one.text }}
          <title>{{ one.full }}</title>
        </text>
      </g>
      <g class="dt-ml-loadings__cells">
        <rect
          v-for="cell in props.view.cells"
          :key="cell.key"
          class="dt-ml-loadings__cell"
          :class="{ 'dt-ml-loadings__cell--negative': cell.isNegative }"
          :x="cell.left"
          :y="cell.top"
          :width="cell.size"
          :height="cell.size"
        >
          <title>{{ cell.hint }}</title>
        </rect>
      </g>
    </svg>
  </figure>
</template>

<style scoped lang="scss">
.dt-ml-loadings {
  // 上限归摆放它的那一区给，44rem 只是兜底：viewBox 会把 7px 的字连同线宽一起
  // 等比放大，没有上限的宽容器里字就成了三四倍
  max-width: var(--dt-ml-chart-max, 44rem);
  margin: 0;

  svg {
    width: 100%;
  }

  text {
    fill: var(--text-disabled);
    font-size: 7px;
  }

  // 行名右对齐贴着格子，列名从格子上方斜着往右上排
  &__rows text {
    text-anchor: end;
  }

  &__cols text {
    text-anchor: start;
  }

  // 正载荷实心
  &__cell {
    fill: rgba(var(--accent-primary-rgb), 0.75);
    stroke: none;
  }

  // 负载荷空心描边：不用第二个色相——两个色相在六套预设下的对比关系不稳定，
  // 而空心与实心在灰度打印与色觉障碍下照样分得开
  &__cell--negative {
    fill: none;
    stroke: var(--text-secondary);
    stroke-width: 1;
  }
}
</style>
