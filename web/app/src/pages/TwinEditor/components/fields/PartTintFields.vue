<script setup lang="ts">
/**
 * @fileoverview 部件的状态染色：开关、取色方式、档位表 / 渐变，以及回落色。
 *
 * ⚠ 开关一关，这个部件就不再占 `partValues` 的绑定行，**已经绑上的点位会跟着
 * 丢掉**（绑定按行号存，行没了就没了）。所以关之前先说清楚。
 * ⚠ 档位自上而下取第一个命中的：顺序就是优先级，区间重叠时靠它定胜负。
 */
import {
  TWIN_TINT_MODES,
  type TwinPartTint,
  type TwinTintGradient,
  type TwinTintMode,
  type TwinTintStop,
} from '@dt/twin-config'
import {
  DtButton,
  DtColorInput,
  DtEmpty,
  DtField,
  DtNotice,
  DtNumberInput,
  DtSegmented,
  DtSwitch,
} from '@dt/ui'
import { computed } from 'vue'

import { blankTintStop, newTintRule } from '../../scripts/partTintOps'
import TintStopRow from './TintStopRow.vue'

const props = defineProps<{
  modelValue: TwinPartTint | null
  /** 这个部件在绑定页上已经挑好点位了吗；没绑的话染色永远只会是回落色。 */
  bound: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [TwinPartTint | null] }>()

const SWATCHES = [
  '--state-success',
  '--state-warning',
  '--state-danger',
  '--accent-primary',
] as const

const MODE_LABELS: Readonly<Record<TwinTintMode, string>> = {
  stops: '按档取色',
  gradient: '区间渐变',
}

const modeOptions = TWIN_TINT_MODES.map((value) => ({
  value,
  label: MODE_LABELS[value],
}))

const tint = computed(() => props.modelValue)

function write(patch: Partial<TwinPartTint>): void {
  if (tint.value === null) return
  emit('update:modelValue', { ...tint.value, ...patch })
}

function toggle(on: boolean): void {
  emit('update:modelValue', on ? newTintRule() : null)
}

function writeMode(next: string): void {
  const mode = TWIN_TINT_MODES.find((item) => item === next)
  if (mode !== undefined) write({ mode })
}

function writeGradient(patch: Partial<TwinTintGradient>): void {
  if (tint.value === null) return
  write({ gradient: { ...tint.value.gradient, ...patch } })
}

function writeStops(stops: TwinTintStop[]): void {
  write({ stops })
}

function patchStop(index: number, next: TwinTintStop): void {
  if (tint.value === null) return
  writeStops(tint.value.stops.map((stop, at) => (at === index ? next : stop)))
}

function addStop(): void {
  if (tint.value === null) return
  writeStops([...tint.value.stops, blankTintStop(tint.value.stops)])
}

function removeStop(index: number): void {
  if (tint.value === null) return
  writeStops(tint.value.stops.filter((_, at) => at !== index))
}

/**
 * 挪动一档。
 * @param index 当前位置
 * @param delta -1 上移，1 下移
 */
function moveStop(index: number, delta: number): void {
  if (tint.value === null) return
  const next = [...tint.value.stops]
  const moved = next[index]
  const to = index + delta
  if (to < 0 || to >= next.length || moved === undefined) return
  next.splice(index, 1)
  next.splice(to, 0, moved)
  writeStops(next)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs text-text-secondary">按点位取色</span>
      <DtSwitch
        :model-value="tint !== null"
        aria-label="按点位取色"
        size="sm"
        @update:model-value="toggle"
      />
    </div>

    <template v-if="tint !== null">
      <DtNotice v-if="!bound" intent="warning" icon="alert-triangle">
        这个部件还没挑点位：去右栏「绑定」页给它挑一个，否则颜色永远只会是回落色。
      </DtNotice>

      <DtSegmented
        :model-value="tint.mode"
        :options="modeOptions"
        aria-label="取色方式"
        size="sm"
        @update:model-value="writeMode"
      />

      <template v-if="tint.mode === 'stops'">
        <p class="text-xs text-text-disabled">
          自上而下取第一个命中的档：顺序就是优先级。区间是「下界含、上界不含」。
        </p>
        <TintStopRow
          v-for="(stop, index) in tint.stops"
          :key="stop.id"
          :model-value="stop"
          :index="index"
          :total="tint.stops.length"
          :swatches="SWATCHES"
          @update:model-value="patchStop(index, $event)"
          @move="moveStop(index, $event)"
          @remove="removeStop(index)"
        />
        <DtEmpty
          v-if="tint.stops.length === 0"
          size="inline"
          title="一档都没配，这个部件的颜色永远只会是回落色。"
        />
        <DtButton variant="soft" size="sm" icon="plus" block @click="addStop">
          添加一档
        </DtButton>
      </template>

      <template v-else>
        <div class="flex items-center gap-1.5">
          <DtField class="min-w-0 flex-1" label="区间下端" size="sm">
            <DtNumberInput
              :model-value="tint.gradient.min"
              aria-label="区间下端"
              size="sm"
              :steppers="false"
              @update:model-value="writeGradient({ min: $event ?? 0 })"
            />
          </DtField>
          <DtField class="min-w-0 flex-1" label="区间上端" size="sm">
            <DtNumberInput
              :model-value="tint.gradient.max"
              aria-label="区间上端"
              size="sm"
              :steppers="false"
              @update:model-value="writeGradient({ max: $event ?? 0 })"
            />
          </DtField>
        </div>
        <DtColorInput
          :model-value="tint.gradient.from"
          label="下端色"
          size="sm"
          :swatches="SWATCHES"
          @update:model-value="writeGradient({ from: $event })"
        />
        <DtColorInput
          :model-value="tint.gradient.to"
          label="上端色"
          size="sm"
          :swatches="SWATCHES"
          @update:model-value="writeGradient({ to: $event })"
        />
        <p class="text-xs text-text-disabled">
          值超出区间时按最近的那一端取色；上下端相等时恒取下端色。
        </p>
      </template>

      <DtColorInput
        :model-value="tint.fallback"
        label="回落色"
        size="sm"
        placeholder="留空 = 退回常态色"
        :swatches="SWATCHES"
        hint="一档都没命中、点位掉线或值不是数时用它。"
        @update:model-value="write({ fallback: $event })"
      />
    </template>

    <p v-else class="text-xs text-text-disabled">
      关着时这个部件不取数，也不会在绑定页上占一行。
    </p>
  </div>
</template>
