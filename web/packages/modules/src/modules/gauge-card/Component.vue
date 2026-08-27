<script lang="ts">
/**
 * @fileoverview gauge-card 的渲染：读一次形态与仪表，摆成一张网格，逐个交给 `GaugeShape`
 * 画表盘、`GaugeReadout` 画读数（MODULE_INFO_CARD_DESIGN §4.2）。取值与档位全在
 * `gauges.ts` / `look.ts` 两个纯函数文件里，本文件只做「读 config → 摆件」。
 *
 * ⚠ 绑定槽键要在本文件里字面读一遍：「声明的槽与渲染侧真读的槽逐一对上」那条闸
 * 只扫模块目录本身、不跟着 import 走，写在 `gauges.ts` 里不算数。
 * ⚠ `title` 同理要在这里读：整个模块只有这一处消费它，漏了就被判成死字段。
 * ⚠ 读数摆图形中央那一档走 `GaugeShape` 的居中插槽，另外两档是 `.gc-cell` 的兄弟节点：
 * 居中层绝对定位在图形上，摆成兄弟会被量程端点那一行顶偏。
 */

/** 一个仪表都没配时替代整块空白的一句话，与参考仓 entity-gauge 的空态同款。 */
const EMPTY_NOTE = '未配置仪表'
</script>

<script setup lang="ts">
import type { InteractionEvent, ModuleMeta } from '@dt/contracts'
import { computed, type CSSProperties } from 'vue'

import { readText } from '../../shared/config'
import { rowClickEmitter } from '../../shared/interaction'
import ModulePanel from '../../shared/ModulePanel.vue'
import GaugeReadout from './GaugeReadout.vue'
import { GAUGE_SLOT_KEY, buildGaugeViews, type GaugeView } from './gauges'
import GaugeShape from './GaugeShape.vue'
import { readGaugeLook } from './look'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

const emit = defineEmits<{ interaction: [event: InteractionEvent] }>()

// 空值不上抛由它兜着；吞不吞冒泡按这一个有没有配联动值分开决定
const onPick = rowClickEmitter(emit)

const views = computed(() =>
  buildGaugeViews({
    config: props.config,
    rows: props.values[GAUGE_SLOT_KEY],
    slots: props.meta?.slots,
  }),
)

// ⚠ 形态要等仪表个数出来才读得准：`layout: 'auto'` 靠个数在「单个铺满」与「网格」之间二选一
const look = computed(() => readGaugeLook(props.config, views.value.length))

const title = computed(() => readText(props.config.title))

/**
 * 这一个的读数那一组有没有东西可画。
 * ⚠ 标签与读数**都**空时整组不渲染：`readout: 'none'` 且没配名称的一排纯图形，留一个
 * 空壳会占掉一行行高，图形跟着偏几像素。
 * @param view 这一个仪表要画的全部东西
 */
function hasReadout(view: GaugeView): boolean {
  return view.text !== '' || view.label !== ''
}

/**
 * 一个仪表的修饰类：整块的档位类原样带上，标签位置只在标签真渲染时才挂。
 * ⚠ 无标签时挂 `label-left` 会多出一列空位与一道列间距，令读数偏移几像素。
 * @param view 这一个仪表要画的全部东西
 */
function cellClasses(view: GaugeView): (string | Record<string, boolean>)[] {
  return [
    ...look.value.classes,
    view.label === '' ? '' : `gc-cell--label-${look.value.labelPlace}`,
    { 'gc-cell--pick': view.emitValue !== '' },
  ]
}

/**
 * 块级变量也摊在每一个仪表上：一个因此能脱开容器单独挂载，观感与在墙上一模一样。
 * @param view 这一个仪表要画的全部东西
 */
function cellStyle(view: GaugeView): CSSProperties {
  return { ...look.value.vars, ...view.vars }
}

/**
 * 点某一个仪表。
 * ⚠ 吞冒泡是**有条件**的：配了联动值就吞（否则同一次点击会再被「整块可点」兜底
 * 抛一个没有 value 的 click，toggle 类动作当场自我抵消）；没配就放它上去。
 * @param event 原生点击事件
 * @param view 这一个仪表要画的全部东西
 */
function onCellClick(event: MouseEvent, view: GaugeView): void {
  if (view.emitValue === '') return
  event.stopPropagation()
  onPick(view.emitValue)
}
</script>

<template>
  <ModulePanel :title="title">
    <p v-if="views.length === 0" class="gc-empty">{{ EMPTY_NOTE }}</p>
    <div v-else class="gc-grid" :style="look.gridStyle">
      <div
        v-for="view in views"
        :key="view.key"
        class="gc-cell"
        :class="cellClasses(view)"
        :style="cellStyle(view)"
        @click="onCellClick($event, view)"
      >
        <GaugeReadout
          v-if="look.readoutPlace !== 'center' && hasReadout(view)"
          :view="view"
        />
        <GaugeShape :view="view" :look="look">
          <template
            v-if="look.readoutPlace === 'center' && hasReadout(view)"
            #center
          >
            <GaugeReadout :view="view" />
          </template>
        </GaugeShape>
      </div>
    </div>
  </ModulePanel>
</template>

<style scoped lang="scss">
@use './variants';

// 网格自身（列模板、仪表间距、整块内边距）由 look.gridStyle 摊成内联样式，这里只管铺满与裁剪
.gc-grid {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  align-items: stretch;
  overflow: hidden;
}

.gc-empty {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  color: var(--text-disabled);
  font-size: 12px;
  letter-spacing: 0.06em;
}
</style>
