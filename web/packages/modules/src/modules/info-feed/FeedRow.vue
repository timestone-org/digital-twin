<script setup lang="ts">
/**
 * @fileoverview 信息流里的一条：级别圆点 ｜ 级别文字 ｜ 正文 ｜ 时刻，四件都按「有没有内容」
 * 决定画不画，档位名一概不进模板（MODULE_INFO_CARD_DESIGN §4.3）。
 * ⚠ 圆点与级别文字是同一件事的两种编码：色觉障碍、大屏远看与读屏都读不出色相，
 * 关掉级别文字就只剩色相在表达级别。
 */
import { computed } from 'vue'

import type { FeedRowView } from './feed'
import type { FeedLook } from './look'

const props = defineProps<{ row: FeedRowView; look: FeedLook }>()

const emit = defineEmits<{ pick: [value: string] }>()

/** 未识别级别不编造文字，关了级别文字也不画。 */
const showLevel = computed(
  () => props.look.show.level && props.row.label !== '',
)

/** 时刻是后端直通文本，这一条没推时刻就不占位。 */
const showTime = computed(() => props.look.show.time && props.row.time !== '')

/**
 * 正文的完整文本，挂 `title` 给被截断的长句用。
 * ⚠ 没有正文的那一条不挂：浮出来一个「—」是纯噪音。
 */
const fullText = computed(() =>
  props.row.pickValue === '' ? undefined : props.row.text,
)

/**
 * 点这一条。
 * ⚠ 吞冒泡是**有条件**的：有正文才吞（否则同一次点击会再被「整块可点」兜底抛一个
 * 没有 value 的 click，toggle 类动作当场自我抵消）；没正文就放它上去。
 * @param event 原生点击事件
 */
function onPick(event: MouseEvent): void {
  if (props.row.pickValue === '') return
  event.stopPropagation()
  emit('pick', props.row.pickValue)
}
</script>

<template>
  <div class="if-row" :class="look.classes" :style="row.vars" @click="onPick">
    <span v-if="look.show.dot" class="if-dot" aria-hidden="true" />
    <span v-if="showLevel" class="if-level">{{ row.label }}</span>
    <span class="if-text" :title="fullText">{{ row.text }}</span>
    <span v-if="showTime" class="if-time">{{ row.time }}</span>
  </div>
</template>

<style scoped lang="scss">
@use './variants';
</style>
