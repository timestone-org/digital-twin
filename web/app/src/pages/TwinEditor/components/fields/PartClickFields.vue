<script setup lang="ts">
/**
 * @fileoverview 部件点击动作、共用取景目标与可选的远近距离分界。
 * 动作语义见 docs/TWIN_PART_INTERACTION_DESIGN.md。
 */
import type {
  TwinCamera,
  TwinClickDistanceRule,
  TwinDistanceRule,
  TwinPartClick,
} from '@dt/twin-config'
import { partFocusView } from '@dt/twin-config'
import { DtButton, DtField, DtNotice, DtSegmented, DtSelect } from '@dt/ui'
import { computed, inject } from 'vue'
import { TWIN_PREVIEW_INTENT } from '../../scripts/previewIntent'
const previewIntent = inject(TWIN_PREVIEW_INTENT, undefined)

import DistanceField from './DistanceField.vue'

const props = defineProps<{
  modelValue: TwinPartClick
  /** 三条距离阈值；与动作同属一节，分开摆会让人对不上远近两档说的是哪个数。 */
  distance: TwinClickDistanceRule
  /** 预设视点，「飞到取景」可以挑一个。 */
  cameras: readonly TwinCamera[]
}>()

const emit = defineEmits<{
  'update:modelValue': [TwinPartClick]
  'update:distance': [TwinClickDistanceRule]
  /** 把视口当前机位存成这个部件的取景快照。 */
  captureView: []
}>()

const FAR_OPTIONS = [
  { value: 'approach', label: '聚焦部件' },
  { value: 'view', label: '切换至指定视角' },
  { value: 'none', label: '不响应' },
] as const

const NEAR_OPTIONS = [
  { value: 'none', label: '仅触发联动' },
  { value: 'view', label: '切换至指定视角' },
  { value: 'detail', label: '弹出部件详情' },
] as const

const VIEW_SOURCES = [
  { value: 'camera', label: '预设视点' },
  { value: 'snapshot', label: '取景快照' },
] as const

const hasFarThreshold = computed(() => props.distance.farThreshold !== null)
const nearLabel = computed(() =>
  hasFarThreshold.value ? '近距点击动作' : '点击动作',
)
const usesView = computed(
  () =>
    props.modelValue.near === 'view' ||
    (hasFarThreshold.value && props.modelValue.far === 'view'),
)

const cameraOptions = computed(() => [
  { value: '', label: '不使用预设视点' },
  ...props.cameras.map((item, index) => ({
    value: item.id,
    label: item.name === '' ? `视点 ${index + 1}` : item.name,
  })),
])

const viewText = computed(() => {
  const view = props.modelValue.view
  if (view === null) return '尚未保存取景快照'
  const position = view.position.map((axis) => axis.toFixed(1)).join(', ')
  const target = view.target.map((axis) => axis.toFixed(1)).join(', ')
  return `机位 (${position}) → 注视 (${target})，视野 ${view.fov.toFixed(0)}°`
})

/** 选了远档动作却没配分界：每一下都算近距点击，远档整个不存在。 */
const noFarThreshold = computed(
  () =>
    props.modelValue.far === 'view' &&
    props.modelValue.near !== 'view' &&
    props.distance.farThreshold === null,
)

/** 选了「飞到取景」却什么都没配：运行态会退回自动框住。 */
const missingTarget = computed(
  () =>
    usesView.value &&
    partFocusView({ click: props.modelValue }, props.cameras) === null,
)

const danglingCamera = computed(
  () =>
    props.modelValue.viewSource === 'camera' &&
    props.modelValue.cameraId !== '' &&
    !props.cameras.some((item) => item.id === props.modelValue.cameraId),
)

function write(patch: Partial<TwinPartClick>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function writeFar(next: string): void {
  const found = FAR_OPTIONS.find((item) => item.value === next)
  if (found !== undefined) write({ far: found.value })
}

function writeNear(next: string): void {
  const found = NEAR_OPTIONS.find((item) => item.value === next)
  if (found !== undefined) write({ near: found.value })
}

function writeViewSource(next: string): void {
  const found = VIEW_SOURCES.find((item) => item.value === next)
  if (found !== undefined) write({ viewSource: found.value })
}

function writeDistance(patch: Partial<TwinClickDistanceRule>): void {
  emit('update:distance', { ...props.distance, ...patch })
}

function writeFarThreshold(farThreshold: TwinDistanceRule | null): void {
  writeDistance({ farThreshold })
}

function writeMin(min: TwinDistanceRule | null): void {
  writeDistance({ min })
}

function writeMax(max: TwinDistanceRule | null): void {
  writeDistance({ max })
}
</script>

<template>
  <div class="flex flex-col gap-3" @focusin="previewIntent?.('click')">
    <DistanceField
      :model-value="distance.farThreshold"
      label="远近距离分界"
      :fallback="30"
      @update:model-value="writeFarThreshold"
    />

    <DtField v-if="hasFarThreshold" label="远距点击动作" size="sm">
      <DtSelect
        :model-value="modelValue.far"
        :options="FAR_OPTIONS"
        aria-label="远距点击动作"
        size="sm"
        @update:model-value="writeFar"
      />
    </DtField>

    <DtField :label="nearLabel" size="sm">
      <DtSelect
        :model-value="modelValue.near"
        :options="NEAR_OPTIONS"
        :aria-label="nearLabel"
        size="sm"
        @update:model-value="writeNear"
      />
    </DtField>
    <p v-if="distance.farThreshold === null" class="text-xs text-text-disabled">
      未设置远近距离分界，所有点击都执行此动作。
    </p>
    <DtNotice v-if="noFarThreshold" intent="warning" icon="alert-triangle">
      已保留远距取景配置，远距动作暂不生效。启用远近距离分界，或将点击动作设为切换至指定视角。
    </DtNotice>

    <template v-if="usesView">
      <DtField label="目标视角来源" size="sm">
        <DtSegmented
          :model-value="modelValue.viewSource"
          :options="VIEW_SOURCES"
          aria-label="目标视角来源"
          size="sm"
          block
          @update:model-value="writeViewSource"
        />
      </DtField>
      <p class="text-xs text-text-disabled">
        切换来源会保留已有配置，远近切视角共用同一个目标。
      </p>
      <template v-if="modelValue.viewSource === 'snapshot'">
        <DtField label="取景快照" size="sm">
          <code
            class="block truncate rounded bg-surface-sunken px-2 py-1 text-xs text-text-secondary"
            >{{ viewText }}</code
          >
        </DtField>
        <DtButton
          variant="soft"
          size="sm"
          icon="refresh-cw"
          block
          data-test="part-capture-view"
          @click="emit('captureView')"
        >
          取当前机位
        </DtButton>
        <DtButton
          v-if="modelValue.view !== null"
          variant="ghost"
          size="sm"
          block
          data-test="part-clear-view"
          @click="write({ view: null, viewSource: 'camera' })"
        >
          清除取景
        </DtButton>
      </template>

      <DtField v-else label="预设视点" size="sm">
        <DtSelect
          :model-value="modelValue.cameraId"
          :options="cameraOptions"
          aria-label="预设视点"
          size="sm"
          @update:model-value="write({ cameraId: $event })"
        />
      </DtField>
      <DtNotice v-if="danglingCamera" intent="danger" icon="alert-circle">
        视点
        {{ modelValue.cameraId }} 不存在，点击将自动聚焦部件。
      </DtNotice>
      <DtNotice
        v-else-if="missingTarget"
        intent="warning"
        icon="alert-triangle"
      >
        当前取景尚未配置完整，点击将自动聚焦部件。
      </DtNotice>
    </template>

    <p class="text-xs text-text-disabled">
      普通点击和近距点击会同时触发联动；远距动作只控制镜头。
    </p>

    <DistanceField
      :model-value="distance.min"
      label="近于此距离不响应"
      :fallback="1"
      @update:model-value="writeMin"
    />
    <DistanceField
      :model-value="distance.max"
      label="远于此距离不响应"
      :fallback="80"
      @update:model-value="writeMax"
    />
    <p class="text-xs text-text-disabled">
      阈值不大于 0 或无法获取距离时，不应用距离限制。
    </p>
  </div>
</template>
