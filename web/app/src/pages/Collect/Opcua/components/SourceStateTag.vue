<script setup lang="ts">
/**
 * @fileoverview 数据源的运行态徽标：采集中 / 连接中 / 已断开 / 未接管。
 *
 * ⚠ 停用的源单独标一个「已停用」，不与「已断开」混：前者是我们自己关的，
 * 后者是连不上，处置完全不同。
 */
import { computed } from 'vue'
import type { CollectSourceRuntime } from '@dt/contracts'
import { DtTag, DtTooltip } from '@dt/ui'

import { errorSummary, stateLook } from '../sourceState'

const props = defineProps<{
  runtime: CollectSourceRuntime
  isEnabled: boolean
}>()

const look = computed(() => stateLook(props.runtime.state))
const reason = computed(() => errorSummary(props.runtime))
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <DtTag v-if="!isEnabled" intent="neutral" size="sm">已停用</DtTag>
    <DtTooltip v-if="reason" :content="reason">
      <DtTag :intent="look.intent" size="sm">{{ look.label }}</DtTag>
    </DtTooltip>
    <DtTag v-else :intent="look.intent" size="sm">{{ look.label }}</DtTag>
  </div>
</template>
