<script setup lang="ts">
/**
 * @fileoverview 一个格：格外壳 + 部件的纵向流。它**不认识任何一个具体部件**——
 * 逐条交给装配点，加一种部件不必碰这里。
 *
 * ⚠ 格自己不判「有没有值」：那是各部件的事（读数画占位符、进度条整件不画），
 * 在这里统一判的话，一个只摆了名称与分隔线的格会因为没接槽而整格消失。
 */
import { computed, type CSSProperties } from 'vue'

import CardPartRenderer from '../../cardParts/CardPartRenderer.vue'
import { CARD_PART_PLACE_KEY } from '../../cardParts/define'
import { readPlace, toCardLines } from '../../cardParts/lines'
import type { CardCellView, CardPartMeta } from '../../cardParts/types'
import type { CardPartRow } from './cells'
import type { CardAlarm } from './groups'

const props = defineProps<{
  cell: CardCellView
  meta: CardPartMeta
  parts: readonly CardPartRow[]
  /** 格外壳档与格内对齐，由卡片统一下发。 */
  shell: string
  align: string
  /** 部件之间的间距，以及格自己的内边距。 */
  vars: CSSProperties
  /** 这一格点了上抛什么；空串 = 不上抛，也就不该有可点的手感。 */
  emitValue: string
  /** 这一格的告警结论；null = 没规则或没命中。 */
  alarm: CardAlarm | null
}>()

const emit = defineEmits<{ pick: [value: string] }>()

const isPickable = computed(() => props.emitValue !== '')

/**
 * 命中规则时把这一格染成规则的颜色。
 * ⚠ 写成变量而不是直接写 `border-color`：格外壳有三档，直接写会让「左色条」档
 * 当场丢掉自己那套描边（info-list 踩过的同一条）。
 */
const alarmVars = computed<CSSProperties>(() => {
  const color = props.alarm?.hit?.color ?? ''
  return color === '' ? {} : { '--dc-alarm': color }
})

/** 部件摊成行；规则在 `cardParts/lines.ts`，这里只管画。 */
const lines = computed(() =>
  toCardLines(props.parts, (row) => readPlace(row[CARD_PART_PLACE_KEY])),
)

/**
 * ⚠ `.stop`：整块可点由宿主接管，不吞掉的话同一次点击会被兜底再抛一次，
 * toggle 类联动动作当场自我抵消。
 */
function onPick(): void {
  if (isPickable.value) emit('pick', props.emitValue)
}
</script>

<template>
  <div
    class="dc-cell"
    :class="[
      `dc-cell--${shell}`,
      `dc-cell--${align}`,
      {
        'dc-cell--pick': isPickable,
        'dc-cell--alarm': alarm?.hit != null,
        'dc-cell--blink': alarm?.blink === true,
      },
    ]"
    :style="[vars, alarmVars]"
    @click.stop="onPick"
  >
    <template v-for="(line, at) in lines" :key="`line-${String(at)}`">
      <CardPartRenderer
        v-if="line.block !== null"
        :key="`part-${String(line.block.index)}`"
        :kind="line.block.part.kind"
        :row="line.block.part"
        :cell="cell"
        :meta="meta"
      />
      <div v-else class="dc-line">
        <span class="dc-line__side">
          <CardPartRenderer
            v-for="one in line.left"
            :key="`part-${String(one.index)}`"
            :kind="one.part.kind"
            :row="one.part"
            :cell="cell"
            :meta="meta"
          />
        </span>
        <span class="dc-line__side dc-line__side--end">
          <CardPartRenderer
            v-for="one in line.right"
            :key="`part-${String(one.index)}`"
            :kind="one.part.kind"
            :row="one.part"
            :cell="cell"
            :meta="meta"
          />
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dc-cell {
  display: flex;
  flex-direction: column;
  gap: var(--dc-part-gap, 4px);
  min-width: 0;
  padding: var(--dc-cell-py, 8px) var(--dc-cell-px, 12px);
}

/* 一行：左簇推到左、右簇推到右，中间的空档自己撑开 */
.dc-line {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
}

.dc-line__side {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

/* ⚠ 右簇要 `justify-content:end` 而不是 `margin-left:auto`：只有一件时两者等效，
   多件时后者只推第一件，其余仍贴着它 */
.dc-line__side--end {
  justify-content: flex-end;
}

.dc-cell--start {
  align-items: flex-start;
  text-align: left;
}

.dc-cell--center {
  align-items: center;
  text-align: center;
}

.dc-cell--end {
  align-items: flex-end;
  text-align: right;
}

/* 描边小卡：格自己成为一张卡，与整块的卡片框是两层 */
.dc-cell--card,
.dc-cell--accent {
  border: 1px solid var(--card-border, var(--border-subtle));
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
}

.dc-cell--accent {
  border-left: 3px solid var(--accent-primary);
}

.dc-cell--pick {
  cursor: pointer;
}

/* 告警态叠在外壳之上：做成第四档外壳的话，左色条档会当场丢掉自己那套描边 */
.dc-cell--alarm {
  border-color: var(--dc-alarm, var(--state-danger));
  animation: dc-cell-alarm 1.2s ease-in-out infinite;
}

.dc-cell--blink {
  animation: dc-cell-blink 1s steps(1, end) infinite;
}

/* 两态同时成立时两条动画都要在：只写一条的话后写的那条会整条顶掉前一条 */
.dc-cell--alarm.dc-cell--blink {
  animation:
    dc-cell-alarm 1.2s ease-in-out infinite,
    dc-cell-blink 1s steps(1, end) infinite;
}

@keyframes dc-cell-alarm {
  0%,
  100% {
    box-shadow: 0 0 0
      color-mix(in srgb, var(--dc-alarm, var(--state-danger)) 0%, transparent);
  }

  50% {
    box-shadow: 0 0 14px
      color-mix(in srgb, var(--dc-alarm, var(--state-danger)) 55%, transparent);
  }
}

@keyframes dc-cell-blink {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.45;
  }
}
</style>
