<script setup lang="ts">
/**
 * @fileoverview info-feed 的渲染：读一次形态与条目，交给共用的自动滚动视口，
 * 一条由 `FeedRow` 画（MODULE_INFO_CARD_DESIGN §4.3）。取值全在 `feed.ts` 与
 * `look.ts` 两个纯函数文件里，本文件只做「读 config → 摆件」。
 *
 * ⚠ 绑定槽键要在本文件里字面读一遍：「声明的槽与渲染侧真读的槽逐一对上」那条闸
 * 只扫模块目录本身、不跟着 import 走，写在 `feed.ts` 里不算数。
 * ⚠ 两个滚动键同理要在这里字面读一遍：`shared/scroll.ts` 写的是 `config?.autoScroll`，
 * 可选链绕过了「死字段」闸的正则，那两个键会被判成声明了没人读。
 * ⚠ 七个尺寸变量摊在列表这一层而不是逐行：变量会往下继承，摊在行上等于每条都重算一遍。
 */
import type { InteractionEvent, ModuleMeta } from '@dt/contracts'
import { computed } from 'vue'

import { readText } from '../../shared/config'
import { rowClickEmitter } from '../../shared/interaction'
import ModulePanel from '../../shared/ModulePanel.vue'
import { readScrollSettings } from '../../shared/scroll'
import ScrollList from '../../shared/ScrollList.vue'
import { FEED_SLOT_KEY, buildFeedRows, readFeedEmptyText } from './feed'
import FeedRow from './FeedRow.vue'
import { readFeedLook } from './look'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

const emit = defineEmits<{ interaction: [event: InteractionEvent] }>()

// 空值不上抛由它兜着；吞不吞冒泡按这一条有没有正文分开决定（见 FeedRow）
const onPick = rowClickEmitter(emit)

const look = computed(() => readFeedLook(props.config))

const rows = computed(() =>
  buildFeedRows({ config: props.config, rows: props.values[FEED_SLOT_KEY] }),
)

const title = computed(() => readText(props.config.title))

// 一条都摆不出来时那一句话；未绑定、等首帧与推来空数组在这里长得一模一样
const emptyText = computed(() => readFeedEmptyText(props.config))

const scroll = computed(() =>
  readScrollSettings({
    autoScroll: props.config.autoScroll,
    scrollSpeed: props.config.scrollSpeed,
  }),
)
</script>

<template>
  <ModulePanel :title="title">
    <div class="if-list" :style="look.vars">
      <p v-if="rows.length === 0" class="if-empty">{{ emptyText }}</p>
      <ScrollList
        v-else
        class="if-scroll"
        :item-count="rows.length"
        :auto-scroll="scroll.autoScroll"
        :seconds-per-item="scroll.scrollSpeed"
      >
        <FeedRow
          v-for="row in rows"
          :key="row.key"
          :row="row"
          :look="look"
          @pick="onPick"
        />
      </ScrollList>
    </div>
  </ModulePanel>
</template>

<style scoped lang="scss">
.if-list {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  // 整块内边距逐字取自参考仓 `.fl-body`：同屏几个列表卡片的内容起始线要对齐
  padding: 4px 6px 6px;
}

// 滚动视口吃掉剩下的全部高度；min-height 不给 0 的话它撑着不缩
.if-scroll {
  min-height: 0;
  flex: 1 1 auto;
}

.if-empty {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  margin: 0;
  color: var(--text-disabled);
  font-size: 13px;
}
</style>
