<script setup lang="ts">
/**
 * @fileoverview data-table 的渲染：读一次形态与表，摆成一行表头加 N 行数据。
 * 表头与数据行共用同一份列宽模板（`--dtb-cols-tpl`），逐格四档由 `cells.ts` 定好、
 * 这里只按 `state` 挂修饰类，见 docs/MODULE_DATA_TABLE_DESIGN.md §5。
 *
 * ⚠ 顶层配置键在本文件里字面读一遍：判「声明了没人读」的那道闸认的是 `config.<键>`
 * 这种写法，而绑定槽键那条闸只扫模块目录本身。
 * ⚠ 行的 `key` 是行名签名加出现序，不是下标：用下标做键会让「删掉中间一行」
 * 变成「最后一行消失、其余全部错位」。
 */
import type { InteractionEvent, ModuleMeta } from '@dt/contracts'
import { computed } from 'vue'

import { readText } from '../../shared/config'
import ModulePanel from '../../shared/ModulePanel.vue'
import { buildTableView, CELL_SLOT_KEY, type TableRowView } from './cells'
import { readTableLook, type TableVars } from './look'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

const emit = defineEmits<{ interaction: [event: InteractionEvent] }>()

const title = computed(() => readText(props.config.title))

const look = computed(() => readTableLook(props.config))

const view = computed(() =>
  buildTableView({
    config: props.config,
    rows: props.values[CELL_SLOT_KEY],
    slots: props.meta?.slots,
  }),
)

/**
 * 整块的 CSS 变量：外观那一半来自 `look`，列宽模板来自数据侧算出的那一份。
 * ⚠ 列宽模板只在这里落一次，表头与数据行都读同一个变量——两处各拼一份就会错列。
 */
const vars = computed<TableVars>(() => ({
  ...look.value.vars,
  '--dtb-cols-tpl': view.value.columnsTemplate,
}))

/**
 * 点这一行。
 * ⚠ 吞冒泡是**有条件**的：配了行名就吞（否则同一次点击会再被「整块可点」兜底抛一个
 * 没有 value 的 click，toggle 类动作当场自我抵消）；没配就放它上去。
 * @param row 被点的那一行
 * @param event 原生点击事件
 */
function onPick(row: TableRowView, event: MouseEvent): void {
  if (row.emitValue === '') return
  event.stopPropagation()
  emit('interaction', { event: 'click', value: row.emitValue })
}
</script>

<template>
  <ModulePanel :title="title">
    <div class="dtb" :class="look.classes" :style="vars">
      <p v-if="view.empty.isEmpty" class="dtb-empty">{{ view.empty.text }}</p>
      <div v-else class="dtb-scroll" role="table">
        <div v-if="look.header.show" class="dtb-head" role="row">
          <span class="dtb-headcell dtb-headcell--name" role="columnheader">
            {{ look.header.name }}
          </span>
          <span
            v-for="column in view.columns"
            :key="column.key"
            class="dtb-headcell"
            :class="`dtb--align-${column.align}`"
            role="columnheader"
            :title="column.name === '' ? undefined : column.name"
          >
            {{ column.name === '' ? column.key : column.name }}
          </span>
        </div>
        <div
          v-for="row in view.rows"
          :key="row.key"
          class="dtb-row"
          :class="{ 'dtb-row--pick': row.emitValue !== '' }"
          role="row"
          @click="onPick(row, $event)"
        >
          <span class="dtb-name" role="rowheader" :title="row.name">
            {{ row.name }}
          </span>
          <span
            v-for="cell in row.cells"
            :key="cell.key"
            class="dtb-cell"
            :class="[
              `dtb-cell--${cell.state}`,
              `dtb--align-${cell.align}`,
              { 'dtb-cell--blink': cell.blink },
            ]"
            role="cell"
            :style="cell.color === '' ? undefined : { color: cell.color }"
            :title="cell.title === '' ? undefined : cell.title"
          >
            {{ cell.text }}
          </span>
        </div>
      </div>
      <p v-for="note in view.notes" :key="note" class="dtb-note">{{ note }}</p>
    </div>
  </ModulePanel>
</template>

<style scoped lang="scss">
@use './variants';
</style>
