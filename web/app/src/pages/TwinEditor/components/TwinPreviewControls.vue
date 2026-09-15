<script setup lang="ts">
/** @fileoverview 部件预览模式、动作预演与漫游段选择。 */
import { buildRoamSegments, type TwinConfig } from '@dt/twin-config'
import { DtButton, DtNotice, DtSegmented, DtSelect } from '@dt/ui'
import { computed } from 'vue'
import type { TwinSelection } from '../scripts/types'
const props = defineProps<{
  config: TwinConfig
  selection: TwinSelection
  partMode: string
  segmentKey: string
  progress: { segmentIndex: number; percent: number; playing: boolean }
  result: string
}>()
const emit = defineEmits<{
  'update:partMode': [string]
  'update:segmentKey': [string]
  action: ['detail' | 'near' | 'far' | 'click']
}>()
const hasVisibilityRules = computed(() => {
  const selection = props.selection
  if (
    !('id' in selection) ||
    selection.kind === 'cameras' ||
    props.partMode === 'click'
  )
    return false
  const visibility = props.config[selection.kind].find(
    (item) => item.id === selection.id,
  )?.visibility
  return (
    visibility !== undefined &&
    (!visibility.visible ||
      visibility.hideAbove !== null ||
      visibility.hideBelow !== null ||
      visibility.fade !== null)
  )
})
const partModes = [
  { value: 'model', label: '部件模型' },
  { value: 'detail', label: '详情卡片' },
  { value: 'click', label: '点击验证' },
]
const segments = computed(() =>
  buildRoamSegments(props.config.cameras, props.config.roamTour),
)
const segmentOptions = computed(() => [
  { value: '', label: '整条漫游' },
  ...segments.value.map((segment) => ({
    value: `${segment.fromId}:${segment.toId}`,
    label: `${props.config.cameras.find((camera) => camera.id === segment.fromId)?.name || segment.fromId} → ${props.config.cameras.find((camera) => camera.id === segment.toId)?.name || segment.toId}`,
  })),
])
const progressText = computed(
  () =>
    `${props.progress.playing ? '播放中' : '已暂停'} · 第 ${props.segmentKey === '' ? props.progress.segmentIndex + 1 : 1} 段 · ${props.progress.percent}%`,
)
</script>
<template>
  <div
    v-if="selection.kind === 'parts'"
    class="flex shrink-0 flex-col gap-2 p-2"
  >
    <DtSegmented
      :model-value="partMode"
      :options="partModes"
      size="sm"
      block
      aria-label="部件预览内容"
      @update:model-value="emit('update:partMode', $event)"
    />
    <DtButton
      v-if="partMode === 'detail'"
      size="xs"
      variant="soft"
      @click="emit('action', 'detail')"
      >打开完整详情弹窗</DtButton
    >
    <template v-if="partMode === 'click'">
      <div class="flex flex-wrap gap-1">
        <DtButton size="xs" @click="emit('action', 'near')"
          >预演近距动作</DtButton
        >
        <DtButton size="xs" @click="emit('action', 'far')"
          >预演远距动作</DtButton
        >
        <DtButton size="xs" variant="soft" @click="emit('action', 'click')"
          >按当前视距测试</DtButton
        >
      </div>
      <p class="text-xs text-text-secondary">
        预演直接展示所配动作；当前视距测试会检查距离限制。联动事件仅在预览内显示。
      </p>
    </template>
    <DtNotice v-if="result" intent="info">{{ result }}</DtNotice>
  </div>
  <div
    v-else-if="selection.kind === 'roam'"
    class="flex shrink-0 flex-col gap-2 p-2"
  >
    <DtSelect
      :model-value="segmentKey"
      :options="segmentOptions"
      label="预览范围"
      size="sm"
      @update:model-value="emit('update:segmentKey', $event)"
    />
    <p v-if="segments.length" class="text-xs" role="status">
      {{ progressText }}
    </p>
    <DtNotice v-else intent="warning"
      >至少配置两个有效视点才能预览漫游。</DtNotice
    >
  </div>
  <p v-if="hasVisibilityRules" class="p-2 text-xs text-text-secondary">
    配置预览临时显示当前对象；实际显隐请切换整屏运行预览核对。
  </p>
</template>
