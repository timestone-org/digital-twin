<script setup lang="ts">
/**
 * @fileoverview 开机策略推荐面板：填一份起始条件 → 全部服务组合同台比，
 * 每个组合各出 p50/区间/开机即达标概率，最快达标的带推荐标。
 *
 * ⚠ 缺测就留空，不要填 0——0 是一个真实且极端的读数。
 * ⚠ 全停时长留空即「未知」，特征层按缺测处理，不会当成刚停就开。
 */
import { computed, ref, watch } from 'vue'
import type {
  AcModel,
  ModelPredictReadings,
  ModelRecommendResult,
} from '@dt/contracts'
import { DtButton, DtNotice, DtNumberInput } from '@dt/ui'

import * as hvac from '@/api/hvac'
import { describeError } from '@/composables/useAsyncList'
import RecommendEntryCard from './RecommendEntryCard.vue'

const props = defineProps<{ model: AcModel }>()

const temps = ref<Record<string, number | undefined>>({})
const humidities = ref<Record<string, number | undefined>>({})
const idle = ref<number | undefined>(undefined)
const busy = ref(false)
const problem = ref<string | null>(null)
const result = ref<ModelRecommendResult | null>(null)

/** 全部服务组合涉及的机组并集：条件按机组填，与选哪个组合无关。 */
const serials = computed(() =>
  [...new Set(props.model.serving_sets.flat())].sort(),
)

watch(
  () => props.model.id,
  () => {
    temps.value = {}
    humidities.value = {}
    idle.value = undefined
    result.value = null
    problem.value = null
  },
)

async function run(): Promise<void> {
  if (busy.value) return
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
    result.value = await hvac.recommendWithAcModel(props.model.id, {
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
    <p class="text-xs text-text-secondary">
      填当前各台的温湿度，比较每个组合要等多久——最快达标的带推荐标。
    </p>
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
    <DtButton intent="primary" size="sm" :loading="busy" @click="run">
      推荐开机策略
    </DtButton>

    <DtNotice v-if="problem" intent="danger">{{ problem }}</DtNotice>

    <div v-if="result" class="flex flex-col gap-2">
      <RecommendEntryCard
        v-for="entry in result.items"
        :key="entry.set_key"
        :entry="entry"
      />
    </div>
  </div>
</template>
