<script setup lang="ts">
/**
 * @fileoverview 试算面板：选组合、填各台温湿度 → 三分位达标时长。
 *
 * ⚠ 缺测就留空，不要填 0——0 是一个真实且极端的读数。
 * ⚠ 全停时长留空即「未知」，特征层按缺测处理，不会当成刚停就开。
 */
import { computed, ref, watch } from 'vue'
import type {
  AcModel,
  ModelPredictReadings,
  ModelPredictResult,
} from '@dt/contracts'
import { DtButton, DtNotice, DtNumberInput, DtSelect, DtTag } from '@dt/ui'

import * as hvac from '@/api/hvac'
import { describeError } from '@/composables/useAsyncList'
import {
  RELIABILITY_VIEW,
  formatMinutes,
  formatSet,
} from '@/features/hvac/modelView'

const props = defineProps<{ model: AcModel }>()

const setKey = ref('')
const temps = ref<Record<string, number | undefined>>({})
const humidities = ref<Record<string, number | undefined>>({})
const idle = ref<number | undefined>(undefined)
const busy = ref(false)
const problem = ref<string | null>(null)
const result = ref<ModelPredictResult | null>(null)

const setOptions = computed(() =>
  props.model.serving_sets.map((set) => ({
    value: formatSet(set),
    label: formatSet(set),
  })),
)

const serials = computed(() => {
  const found = props.model.serving_sets.find(
    (set) => formatSet(set) === setKey.value,
  )
  return found ? [...found].sort() : []
})

watch(
  () => props.model.id,
  () => {
    setKey.value = setOptions.value[0]?.value ?? ''
    result.value = null
    problem.value = null
  },
  { immediate: true },
)

// 换组合后旧结果就是别的组合的答案，必须清掉而不是留着装没事
watch(setKey, () => {
  result.value = null
  problem.value = null
})

async function run(): Promise<void> {
  if (serials.value.length === 0 || busy.value) return
  busy.value = true
  problem.value = null
  try {
    const readings: Record<string, ModelPredictReadings> = {}
    for (const serial of serials.value) {
      const entry: ModelPredictReadings = {}
      const temp = temps.value[serial]
      const humidity = humidities.value[serial]
      if (temp !== undefined) entry.workshop_temp_avg = temp
      if (humidity !== undefined) entry.workshop_humidity_avg = humidity
      if (Object.keys(entry).length > 0) readings[serial] = entry
    }
    result.value = await hvac.predictWithAcModel(props.model.id, {
      running_set: serials.value,
      readings,
      ...(idle.value === undefined ? {} : { idle_minutes: idle.value }),
    })
  } catch (caught) {
    problem.value = describeError(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <DtSelect
      v-model="setKey"
      label="运行组合"
      :options="setOptions"
      :disabled="setOptions.length === 0"
    />
    <div
      v-for="serial in serials"
      :key="serial"
      class="grid grid-cols-[6rem_1fr_1fr] items-end gap-2"
    >
      <span class="pb-2 font-mono text-xs text-text-secondary">
        {{ serial }}
      </span>
      <DtNumberInput
        :model-value="temps[serial]"
        label="温度 ℃"
        size="sm"
        :steppers="false"
        @update:model-value="(value) => (temps[serial] = value)"
      />
      <DtNumberInput
        :model-value="humidities[serial]"
        label="湿度 %"
        size="sm"
        :steppers="false"
        @update:model-value="(value) => (humidities[serial] = value)"
      />
    </div>
    <DtNumberInput
      v-model="idle"
      label="全停时长（分钟，可空）"
      hint="开机前房间停了多久；不知道就留空"
      size="sm"
      :steppers="false"
      :range="{ min: 0, max: 100000 }"
    />
    <DtButton
      intent="primary"
      size="sm"
      :loading="busy"
      :disabled="serials.length === 0"
      @click="run"
    >
      试算
    </DtButton>

    <DtNotice v-if="problem" intent="danger">{{ problem }}</DtNotice>

    <div
      v-if="result"
      class="flex flex-col gap-2 rounded-md border border-border-subtle p-3"
    >
      <p class="flex items-baseline gap-2">
        <span class="text-2xl font-semibold text-text-primary">
          {{ formatMinutes(result.p50) }}
        </span>
        <span class="text-xs text-text-secondary">
          80% 区间 {{ result.p10.toFixed(1) }} – {{ result.p90.toFixed(1) }}
        </span>
      </p>
      <p class="flex items-center gap-2">
        <DtTag size="sm" :intent="RELIABILITY_VIEW[result.reliability].intent">
          {{ RELIABILITY_VIEW[result.reliability].label }}
        </DtTag>
        <DtTag v-if="!result.is_in_serving_sets" size="sm" intent="warning">
          服务组合之外的外推
        </DtTag>
        <DtTag v-if="!result.is_dedicated" size="sm" intent="info">
          组合样本不足，房间共用模型兜底
        </DtTag>
        <DtTag v-else size="sm" intent="success">组合专属模型</DtTag>
      </p>
    </div>
  </div>
</template>
