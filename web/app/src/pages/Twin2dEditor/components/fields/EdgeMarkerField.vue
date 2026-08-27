<script setup lang="ts">
/**
 * @fileoverview 一端的端点标记：没有 / 箭头两档，箭头再摊出大小、张开角、实心与
 * 不透明度四格。起点与终点共用这一副面。
 *
 * ⚠ 张开角在文档里是**弧度**，摆在面上的是度：直接把弧度摆出来的话，用户看到的是
 *   `0.52` 这种数，调一次要在脑子里换算一次，而换错了只是箭头变形、不报错。
 * ⚠ 换回「没有」时不留住箭头那几格：`{ kind: 'none' }` 是完整的一档，塞着几个用不上
 *   的键会在归一化那一步被丢掉，于是「切回箭头」时那几格已经不是原来的值了。
 * ⚠ 控件自己不碰文档，只 emit；连续输入并成一帧撤销的时机由检查器定（见 `blur`）。
 */
import { TWIN_2D_EDGE_MARKER_KINDS } from '@dt/twin2d'
import type { Twin2dEdgeMarker, Twin2dEdgeMarkerKind } from '@dt/twin2d'
import { DtCheckbox, DtNumberInput, DtSelect } from '@dt/ui'
import { computed } from 'vue'

import { TWIN_2D_UNIT_RANGE, enumOptions } from '../../scripts/inspectorFields'

const props = defineProps<{
  modelValue: Twin2dEdgeMarker
  label: string
}>()

const emit = defineEmits<{
  'update:modelValue': [Twin2dEdgeMarker]
  blur: []
}>()

/** 一格张开角是半度；再细就调不动了。 */
const SPREAD_RANGE = { min: 1, max: 89, step: 0.5, precision: 1 }

/** 箭头长度（设计像素）。 */
const SIZE_RANGE = { min: 1, step: 1 }

const KIND_LABELS: Readonly<Record<Twin2dEdgeMarkerKind, string>> = {
  none: '没有',
  arrow: '箭头',
}

const KIND_OPTIONS = enumOptions(TWIN_2D_EDGE_MARKER_KINDS, KIND_LABELS)

/** 切到箭头那一档时给的一份；与归一化的缺省同源，用户一切过去就看得见。 */
const NEW_ARROW: Twin2dEdgeMarker = Object.freeze({
  kind: 'arrow',
  size: 8,
  spread: Math.PI / 8,
  filled: true,
  opacity: 1,
})

const arrow = computed(() =>
  props.modelValue.kind === 'arrow' ? props.modelValue : null,
)

/** 张开角摆成度。 */
const spreadDeg = computed(() =>
  arrow.value === null ? 0 : (arrow.value.spread * 180) / Math.PI,
)

/**
 * 换一档。
 * @param next 下拉给出的取值
 */
function setKind(next: string): void {
  if (next === props.modelValue.kind) return
  emit('update:modelValue', next === 'arrow' ? NEW_ARROW : { kind: 'none' })
}

/**
 * 改箭头的一格。
 * @param patch 要覆盖的字段
 */
function write(patch: Partial<Omit<Twin2dEdgeMarker, 'kind'>>): void {
  const current = arrow.value
  if (current === null) return
  emit('update:modelValue', { ...current, ...patch })
}

/**
 * 改张开角：面上是度，文档里是弧度。
 * @param deg 度数
 */
function setSpread(deg: number): void {
  write({ spread: (deg * Math.PI) / 180 })
}
</script>

<template>
  <div class="flex flex-col gap-1.5" @focusout="emit('blur')">
    <DtSelect
      :model-value="modelValue.kind"
      :options="KIND_OPTIONS"
      :label="label"
      size="sm"
      data-test="marker-kind"
      @update:model-value="setKind"
    />
    <div v-if="arrow !== null" class="grid grid-cols-2 gap-1.5">
      <DtNumberInput
        :model-value="arrow.size"
        :range="SIZE_RANGE"
        label="长度"
        unit="px"
        size="sm"
        :steppers="false"
        data-test="marker-size"
        @update:model-value="write({ size: $event ?? arrow.size })"
      />
      <DtNumberInput
        :model-value="spreadDeg"
        :range="SPREAD_RANGE"
        label="张开半角"
        unit="°"
        size="sm"
        :steppers="false"
        data-test="marker-spread"
        @update:model-value="setSpread($event ?? spreadDeg)"
      />
      <DtNumberInput
        :model-value="arrow.opacity"
        :range="TWIN_2D_UNIT_RANGE"
        label="不透明度"
        size="sm"
        :steppers="false"
        data-test="marker-opacity"
        @update:model-value="write({ opacity: $event ?? arrow.opacity })"
      />
      <DtCheckbox
        :model-value="arrow.filled"
        label="实心"
        size="sm"
        data-test="marker-filled"
        @update:model-value="write({ filled: $event })"
      />
    </div>
  </div>
</template>
