<script setup lang="ts">
/**
 * @fileoverview 四档「没有」，一档都不许合并（结果展示规格 §2-P5）。
 *
 * ⚠ 合成一句「数据不全」之后，用户分不出该去调取数范围、还是这一屏本来就
 * 少画了一块，也分不出这次运行到底该不该重跑。
 */
import type { DtIntent } from '@dt/contracts'
import { DtNotice } from '@dt/ui'
import { computed } from 'vue'

import type { TruncationKind } from '../scripts/reportBlocks'

const props = defineProps<{
  kind: TruncationKind
  /** 被降档丢掉的那些块的标题。只有 `budget` 那一档摆它。 */
  dropped?: readonly string[] | undefined
}>()

interface Wording {
  intent: DtIntent
  icon: string
  text: string
}

// ⚠ 取数是反扫取最新的 limit 行（`dataset/services/record_read.py::scan_window`），
// 触顶时丢的是**更早**那批。方向指反了，用户会往错的一头缩时间范围
const WORDINGS: Record<TruncationKind, Wording> = {
  source: {
    intent: 'warning',
    icon: 'alert-triangle',
    text:
      '取数触了行数上限：只留下了最新的那一批，更早的那些数据根本没有取进来。' +
      '要么把「行数上限」调大，要么把时间范围的起点往后挪。',
  },
  budget: {
    intent: 'warning',
    icon: 'alert-triangle',
    text: '这一步讲的话太长，有几块没能存下来。数据本身没受影响，只是这一屏少画了几块。',
  },
  upstream: {
    intent: 'warning',
    icon: 'alert-triangle',
    text: '上一步的摘要被预算削掉了，这里的前后对比只剩一半。把上游那一步单独跑一次就能看全。',
  },
  missing: {
    intent: 'neutral',
    icon: 'circle-question',
    text: '这次运行没有记下这一项——它跑在结果面上线之前。重跑一次这一步就有了。',
  },
}

const wording = computed(() => WORDINGS[props.kind])

/** 丢掉的块照它们的标题明示，不写「若干块」。 */
const droppedText = computed(() => {
  const names = props.dropped ?? []
  return names.length === 0 ? '' : `省掉的是：${names.join('、')}`
})
</script>

<template>
  <!-- ⚠ 铺一层底色与边：DtNotice 本身只是一行彩色文字，在一屏数字里会被略过,
       而这四句正是「不许被略过」的那几句 -->
  <div class="dt-ml-trunc" :class="`dt-ml-trunc--${props.kind}`">
    <DtNotice :intent="wording.intent" :icon="wording.icon">
      {{ wording.text }}
      <span v-if="droppedText">{{ droppedText }}</span>
    </DtNotice>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-trunc {
  padding: 0.5rem 0.75rem;
  border: 1px solid rgba(var(--state-warning-rgb), 0.35);
  border-radius: var(--radius-md);
  background: rgba(var(--state-warning-rgb), 0.08);

  // 老运行没记这一项不是警示：它不用改什么，只是重跑一次才有
  &--missing {
    border-color: rgba(var(--neutral-fg-rgb), 0.25);
    background: rgba(var(--neutral-fg-rgb), 0.06);
  }
}
</style>
