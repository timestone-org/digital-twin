<script setup lang="ts">
/**
 * @fileoverview 部件的点击：三条距离阈值，加上远近两档各做什么。
 *
 * ⚠ 「两段式分界」是这一节的支点：远于它的一下只算远档（缺省是把部件框进画面），
 * 近于它的才是真点击。三条阈值各自带参考系，脱离参考系的裸数字不可类比。
 * ⚠ 阈值 ≤ 0 或距离取不到时一律按「不限制」走：误挡一次点击的表现是「点了没反应」，
 * 用户找不到原因也没法自行恢复。
 */
import type {
  TwinCamera,
  TwinClickDistanceRule,
  TwinDistanceRule,
  TwinPartClick,
} from '@dt/twin-config'
import { DtButton, DtField, DtNotice, DtSelect } from '@dt/ui'
import { computed } from 'vue'

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
  { value: 'approach', label: '把这个部件框进画面' },
  { value: 'view', label: '飞到指定取景' },
  { value: 'none', label: '不响应' },
] as const

const NEAR_OPTIONS = [
  { value: 'none', label: '只上抛联动事件' },
  { value: 'detail', label: '弹出部件详情' },
] as const

const cameraOptions = computed(() => [
  { value: '', label: '（不挑视点）' },
  ...props.cameras.map((item, index) => ({
    value: item.id,
    label: item.name === '' ? `视点 ${index + 1}` : item.name,
  })),
])

const viewText = computed(() => {
  const view = props.modelValue.view
  if (view === null) return '（没存机位）'
  const position = view.position.map((axis) => axis.toFixed(1)).join(', ')
  const target = view.target.map((axis) => axis.toFixed(1)).join(', ')
  return `机位 (${position}) → 注视 (${target})，视野 ${view.fov.toFixed(0)}°`
})

/** 选了远档动作却没配分界：每一下都算近距点击，远档整个不存在。 */
const noFarThreshold = computed(
  () => props.modelValue.far === 'view' && props.distance.farThreshold === null,
)

/** 选了「飞到取景」却什么都没配：运行态会退回自动框住。 */
const missingTarget = computed(
  () =>
    props.modelValue.far === 'view' &&
    props.modelValue.view === null &&
    props.modelValue.cameraId === '',
)

const danglingCamera = computed(
  () =>
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
  <div class="flex flex-col gap-3">
    <DistanceField
      :model-value="distance.farThreshold"
      label="远近两档的分界"
      :fallback="30"
      @update:model-value="writeFarThreshold"
    />

    <DtField label="远于分界时点击" size="sm">
      <DtSelect
        :model-value="modelValue.far"
        :options="FAR_OPTIONS"
        aria-label="远于分界时点击"
        size="sm"
        @update:model-value="writeFar"
      />
    </DtField>

    <template v-if="modelValue.far === 'view'">
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
        @click="write({ view: null })"
      >
        清除取景
      </DtButton>

      <DtField label="或切到预设视点" size="sm">
        <DtSelect
          :model-value="modelValue.cameraId"
          :options="cameraOptions"
          aria-label="或切到预设视点"
          size="sm"
          @update:model-value="write({ cameraId: $event })"
        />
      </DtField>
      <DtNotice
        v-if="modelValue.view !== null && modelValue.cameraId !== ''"
        intent="warning"
        icon="alert-triangle"
      >
        取景快照优先：上面这个预设视点当前不生效。要用它，先清除取景。
      </DtNotice>
      <DtNotice v-if="danglingCamera" intent="danger" icon="alert-circle">
        视点
        {{ modelValue.cameraId }} 不存在，远距点击会退回把这个部件框进画面。
      </DtNotice>
      <DtNotice v-if="missingTarget" intent="warning" icon="alert-triangle">
        既没存机位也没挑视点，远距点击会退回把这个部件框进画面。
      </DtNotice>
      <DtNotice v-if="noFarThreshold" intent="warning" icon="alert-triangle">
        没配上面的「远近两档的分界」，每一下都算近距点击，这个取景永远飞不到。
      </DtNotice>
    </template>

    <DtField label="近于分界时点击" size="sm">
      <DtSelect
        :model-value="modelValue.near"
        :options="NEAR_OPTIONS"
        aria-label="近于分界时点击"
        size="sm"
        @update:model-value="writeNear"
      />
    </DtField>
    <p class="text-xs text-text-disabled">
      联动事件两档都照发：这里配的是附加动作，不会把同屏别的模块的联动掐掉。
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
      阈值 ≤ 0 或距离取不到时一律按「不限制」走，不误杀点击。
    </p>
  </div>
</template>
