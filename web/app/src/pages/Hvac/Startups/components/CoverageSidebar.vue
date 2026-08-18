<script setup lang="ts">
/**
 * @fileoverview 左栏「组合覆盖」：每个运行组合攒下了多少可用事件，点一条就把
 * 右边的事件列表筛到它。
 *
 * ⚠ 这是页面上最能指导决策的一块——它直接回答「哪些组合的历史够建模、哪些还
 * 差得远」。条数少的必须照样列出来并且看得见，藏起来等于把「这个组合没数据」
 * 说成「这个组合没问题」。
 * ⚠ 一个房间六台空调就是三十多个组合，所以这一栏自己滚，不许把右边的事件挤到
 * 折叠线以下。
 * ⚠ 选中态写回工具条上那个「运行组合」下拉，不另开第二个筛选器：两个控件各记
 * 各的，界面就会出现「列表已筛过、下拉却显示全部」。
 */
import { computed } from 'vue'
import type { CombinationCoverage } from '@dt/contracts'
import { DtEmpty, DtProgress, DtTag } from '@dt/ui'

import { THIN_THRESHOLD, coverageRows } from '../scripts/startupView'

const props = defineProps<{
  items: readonly CombinationCoverage[]
  /** 当前选中的组合，逗号连接的序号串；空串是「全部组合」。 */
  selected: string
}>()

const emit = defineEmits<{ select: [value: string] }>()

const rows = computed(() => coverageRows(props.items))

/** 再点一次选中的那条就回到「全部组合」，不必绕去工具条上取消。 */
function toggle(value: string): void {
  emit('select', props.selected === value ? '' : value)
}
</script>

<template>
  <aside
    class="flex min-h-0 flex-col gap-2 rounded-lg border border-border-subtle bg-surface-panel p-3"
  >
    <div class="flex shrink-0 items-baseline justify-between gap-2">
      <span class="text-xs tracking-widest text-text-secondary">组合覆盖</span>
      <span class="text-2xs text-text-disabled">点一条筛事件</span>
    </div>

    <DtEmpty
      v-if="rows.length === 0"
      title="还没有可用事件"
      hint="抽取完成后，这里按运行组合列出各自攒了多少条。"
    />

    <ul
      v-else
      class="m-0 min-h-0 flex-1 list-none space-y-0.5 overflow-y-auto p-0"
    >
      <li v-for="row in rows" :key="row.value">
        <button
          type="button"
          class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 rounded-md px-2 py-1.5 text-left"
          :class="
            row.value === props.selected
              ? 'bg-accent-primary/10 text-accent-primary'
              : 'text-text-primary hover:bg-surface-raised'
          "
          :aria-pressed="row.value === props.selected"
          :title="row.label"
          @click="toggle(row.value)"
        >
          <span class="truncate text-xs">{{ row.label }}</span>
          <DtTag size="sm" :intent="row.isThin ? 'warning' : 'neutral'">
            {{ row.count }} 条
          </DtTag>
          <DtProgress
            class="col-span-2"
            size="sm"
            :value="row.count"
            :max="row.max"
            :intent="row.isThin ? 'warning' : 'primary'"
          />
        </button>
      </li>
    </ul>

    <p v-if="rows.length > 0" class="shrink-0 text-2xs text-text-disabled">
      少于 {{ THIN_THRESHOLD }} 条的已标黄：样本太少，先别拿它训练。
    </p>
  </aside>
</template>
