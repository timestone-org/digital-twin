<script setup lang="ts">
/**
 * @fileoverview 点位表里的「当前值」一格：值 + 状态徽标 + 采样时刻。
 *
 * ⚠ 「没收到过」「取不到」「有值」三档在这里必须各有各的样子。合并任意两档
 * 都会造出一条假读数——尤其是把「取不到」画成一个空值。
 */
import { computed } from 'vue'
import type { PointSample } from '@dt/contracts'
import { DtTag, DtTooltip } from '@dt/ui'

import { formatSample } from '../liveFormat'

const props = defineProps<{
  sample: PointSample | undefined
  unit: string | null
}>()

const look = computed(() => formatSample(props.sample, props.unit))
</script>

<template>
  <div class="flex flex-col gap-0.5">
    <div class="flex items-center gap-1.5">
      <span class="font-mono">{{ look.text }}</span>
      <DtTooltip v-if="look.reason" :content="look.reason">
        <DtTag :intent="look.intent" size="sm">{{ look.badge }}</DtTag>
      </DtTooltip>
      <DtTag v-else-if="look.badge" :intent="look.intent" size="sm">
        {{ look.badge }}
      </DtTag>
    </div>
    <span v-if="look.at" class="text-2xs text-text-secondary">{{
      look.at
    }}</span>
  </div>
</template>
