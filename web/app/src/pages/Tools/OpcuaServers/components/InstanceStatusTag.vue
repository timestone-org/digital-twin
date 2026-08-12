<script setup lang="ts">
/**
 * @fileoverview 实例运行状态。
 *
 * ⚠ 显示的是 `is_running`（本地监听端口的实况）而不是 `desired_state`（用户意图）。
 * 两者不一致时——按了启动但端口没起来——必须让人看出来，所以不一致会另出一档
 * 「启动中/停止中」而不是安静地按意图显示成「运行中」。
 */
import { computed } from 'vue'
import type { OpcuaDesiredState } from '@dt/contracts'
import { DtTag } from '@dt/ui'

const props = defineProps<{
  isRunning: boolean
  desiredState: OpcuaDesiredState
}>()

const state = computed(() => {
  const wantsRunning = props.desiredState === 'running'
  if (props.isRunning && wantsRunning) {
    return { label: '运行中', intent: 'success' } as const
  }
  if (!props.isRunning && !wantsRunning) {
    return { label: '已停止', intent: 'neutral' } as const
  }
  // 意图与实况不符：正在切换，或者切换失败了
  return props.isRunning
    ? ({ label: '停止中', intent: 'warning' } as const)
    : ({ label: '未就绪', intent: 'danger' } as const)
})
</script>

<template>
  <DtTag :intent="state.intent" size="sm">{{ state.label }}</DtTag>
</template>
