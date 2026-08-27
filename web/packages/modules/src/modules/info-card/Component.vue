<script lang="ts">
/**
 * @fileoverview info-card 的渲染：读一次形态与格，摆成一张网格，逐格交给 `InfoCell` 画
 * （MODULE_INFO_CARD_DESIGN §4.1）。取值与档位全在 `cells.ts` / `look.ts` 两个纯函数文件里，
 * 本文件只做「读 config → 摆件」。
 *
 * ⚠ 绑定槽键要在本文件里字面读一遍：「声明的槽与渲染侧真读的槽逐一对上」那条闸
 * 只扫模块目录本身、不跟着 import 走，写在 `cells.ts` 里不算数。
 * ⚠ `title` 同理要在这里读：整个模块只有这一处消费它，漏了就被判成死字段。
 */

/** 一格都没配时替代整块空白的一句话，与参考仓 kpi-group / icon-kpi-group 同款空态。 */
const EMPTY_NOTE = '未配置指标项'
</script>

<script setup lang="ts">
import type { InteractionEvent, ModuleMeta } from '@dt/contracts'
import { computed } from 'vue'

import { readText } from '../../shared/config'
import { rowClickEmitter } from '../../shared/interaction'
import ModulePanel from '../../shared/ModulePanel.vue'
import { CARD_SLOT_KEY, buildCardCells } from './cells'
import InfoCell from './InfoCell.vue'
import { readCardLook } from './look'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

const emit = defineEmits<{ interaction: [event: InteractionEvent] }>()

// 空值不上抛由它兜着；吞不吞冒泡由 InfoCell 按这一格有没有联动值分开决定
const onPick = rowClickEmitter(emit)

const cells = computed(() =>
  buildCardCells({
    config: props.config,
    rows: props.values[CARD_SLOT_KEY],
    slots: props.meta?.slots,
  }),
)

// ⚠ 形态要等格数出来才读得准：`layout: 'auto'` 靠格数在「单格大字」与「网格」之间二选一
const look = computed(() => readCardLook(props.config, cells.value.length))

const title = computed(() => readText(props.config.title))
</script>

<template>
  <ModulePanel :title="title">
    <p v-if="cells.length === 0" class="ic-empty">{{ EMPTY_NOTE }}</p>
    <div v-else class="ic-card" :class="look.classes" :style="look.gridStyle">
      <InfoCell
        v-for="cell in cells"
        :key="cell.key"
        :cell="cell"
        :look="look"
        @pick="onPick"
      />
    </div>
  </ModulePanel>
</template>

<style scoped lang="scss">
// 网格自身（列模板、格间距、整块内边距）由 look.gridStyle 摊成内联样式，这里只管铺满与裁剪
.ic-card {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  align-items: stretch;
  overflow: hidden;
}

.ic-empty {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  color: var(--text-disabled);
  font-size: 12px;
  letter-spacing: 0.06em;
}
</style>
