<script setup lang="ts">
/**
 * @fileoverview 点位表顶上的提示：实时通道断了。
 *
 * ⚠ 不能省：断了不说，最后一批值会一直挂着冒充现值。
 */
import type { CollectSource } from '@dt/contracts'
import { DtNotice } from '@dt/ui'

defineProps<{
  source: CollectSource
  /** 实时通道此刻是否连着。 */
  isConnected: boolean
}>()
</script>

<template>
  <DtNotice v-if="!isConnected" intent="warning" icon="alert-triangle">
    实时通道未连接，下面的「实时值」可能不是现值。
  </DtNotice>
</template>
