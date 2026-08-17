<script setup lang="ts">
/**
 * @fileoverview 点位表顶上的两条提示：实时通道断了、实时值覆盖不全。
 *
 * ⚠ 两条都不能省。断了不说，最后一批值会一直挂着冒充现值；覆盖不全不说，
 * 超出上限的那些行看起来就像坏了——而它们照常在采集与归档。
 */
import { computed } from 'vue'
import type { CollectSource } from '@dt/contracts'
import { DtNotice } from '@dt/ui'

const props = defineProps<{
  source: CollectSource
  /** 实时通道此刻是否连着。 */
  isConnected: boolean
}>()

/** 配的点位比实时推送的上限多，超出的那些没有实时值。 */
const isTruncated = computed(
  () => props.source.point_count > props.source.live_point_limit,
)
</script>

<template>
  <DtNotice v-if="!isConnected" intent="warning" icon="alert-triangle">
    实时通道未连接，下面的「实时值」可能不是现值。
  </DtNotice>

  <DtNotice v-if="isTruncated" intent="info" icon="alert-circle">
    这个数据源配了 {{ source.point_count }} 个点位，实时值只覆盖按编码升序的前
    {{ source.live_point_limit }} 个；其余点位照常采集与归档，只是这一页看不到
    它们的现值。
  </DtNotice>
</template>
