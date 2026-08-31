<script setup lang="ts">
/**
 * @fileoverview nav-tabs 的渲染：一排原生 `<button>`，点一格上抛一次 `select`
 * 联动事件。选中态只活在本组件里——跳大屏那条路点完就换页，页内分区那条路
 * 由联动规则去改别的节点的显隐，两条路都不需要把选中态写回配置。
 * ⚠ 形态全部收敛在 `look.ts`，本文件只摆模板与那一次上抛。
 */
import type { InteractionEvent, ModuleMeta } from '@dt/contracts'
import { DtIcon } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import { readTabsSpec } from './look'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

const emit = defineEmits<{ interaction: [event: InteractionEvent] }>()

const spec = computed(() => readTabsSpec(props.config))

/** 用户点过的那一格；null = 还没点过，跟着配置里的「默认选中」走。 */
const picked = ref<number | null>(null)

// 改了「默认选中」就回到配置那一档：编辑器里改一个数要当场看得见，
// 而不是还停在上一次点过的那一格上
watch(
  () => spec.value.activeAt,
  () => {
    picked.value = null
  },
)

/** 当前高亮哪一格。⚠ 点过之后把格删到更少时回落配置档，否则高亮落在空处。 */
const activeAt = computed(() => {
  const at = picked.value
  if (at === null || at >= spec.value.items.length) return spec.value.activeAt
  return at
})

/**
 * 点一格：先落本地高亮，再上抛这一格的联动值。
 * ⚠ 空联动值不上抛：没有 value 的事件命不中任何一条按值分派的规则，
 * 抛出去只会误触「值留空」那条路径。
 * @param at 第几格（0 基）
 */
function onPick(at: number): void {
  const tab = spec.value.items[at]
  if (tab === undefined || tab.isDisabled) return
  picked.value = at
  if (tab.emitValue === '') return
  emit('interaction', { event: 'select', value: tab.emitValue })
}
</script>

<template>
  <div class="dt-tabs-host" :style="spec.hostStyle">
    <div
      class="dt-tabs"
      :class="spec.classes"
      :style="spec.vars"
      role="group"
      aria-label="页签栏"
    >
      <button
        v-for="(tab, at) in spec.items"
        :key="tab.key"
        type="button"
        class="dt-tabs__item"
        :class="{ 'is-active': at === activeAt }"
        :aria-pressed="at === activeAt"
        :disabled="tab.isDisabled"
        @click.stop="onPick(at)"
      >
        <DtIcon
          v-if="tab.icon !== ''"
          :name="tab.icon"
          :size="spec.iconSize"
          class="dt-tabs__icon"
        />
        <span class="dt-tabs__label">{{ tab.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use './variants';

// 外层只做排布：轨道按内容尺寸时落在模块矩形的哪一处由它决定
.dt-tabs-host {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.dt-tabs {
  display: inline-flex;
  max-width: 100%;
  max-height: 100%;
  box-sizing: border-box;
  padding: var(--tab-pad);
  border: var(--tab-border-w) solid transparent;
  border-radius: var(--tab-radius);
  gap: var(--tab-gap);
}

.dt-tabs--fill {
  width: 100%;
  height: 100%;
}

.dt-tabs--row {
  flex-direction: row;
  align-items: stretch;
}

.dt-tabs--column {
  flex-direction: column;
  align-items: stretch;
}

// 等分：每一格分同样宽（竖排时是同样高），一条轨道不会因为文案长短参差不齐
.dt-tabs--stretch .dt-tabs__item {
  flex: 1 1 0;
  min-width: 0;
}

.dt-tabs__item {
  position: relative;
  display: inline-flex;
  min-width: 0;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  padding: var(--tab-py) var(--tab-px);
  border: var(--tab-border-w) solid transparent;
  border-radius: var(--tab-item-radius);
  // ⚠ 必须自己写透明底：原生 button 的 UA 缺省底色是浅灰，宿主页面的重置样式
  //   替我们清掉了它，但模块要能脱开那份重置单独渲染
  background: transparent;
  color: var(--tab-text, var(--text-secondary));
  cursor: pointer;
  font-family: inherit;
  font-size: var(--tab-font-size);
  // ⚠ 各档一律同一个字重：选中态加粗会让文字变宽，按内容尺寸时每切一格
  //   整条轨道都要抖一下——要加粗就连未选中的一起加
  font-weight: var(--tab-weight);
  gap: 6px;
  letter-spacing: var(--tab-tracking);
  line-height: 1.2;
  // ⚠ 这里不许 overflow: hidden——分隔线画在格与格之间的空当里，裁掉就没了；
  //   文案的省略号由 __label 自己管
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease,
    filter 0.18s ease,
    transform 0.12s ease;
  user-select: none;
}

.dt-tabs__item:focus-visible {
  outline: 2px solid var(--tab-accent);
  outline-offset: 2px;
}

// 禁用是「这一格现在切不过去」而不是「坏了」：压暗并换指针，文案原样留着
.dt-tabs__item:disabled {
  cursor: not-allowed;
  filter: grayscale(0.4);
  opacity: 0.45;
}

.dt-tabs__item.is-active {
  font-weight: var(--tab-active-weight, var(--tab-weight));
}

.dt-tabs__icon {
  flex: none;
}

.dt-tabs__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
