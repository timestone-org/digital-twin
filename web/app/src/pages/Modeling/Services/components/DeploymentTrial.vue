<script setup lang="ts">
/** @fileoverview 在部署服务中按真实签名试算预测、检测与规则模型。 */
import type { ModelDeployment } from '@dt/contracts'
import { DtButton, DtNotice, DtSpinner, DtTextarea } from '@dt/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { callOpenModel, getOpenModelSignature } from '@/api/modelingServing'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { describeError } from '@/composables/useAsyncList'
import {
  parseTrialRows,
  readTrialModel,
  trialExample,
} from '../scripts/trialInput'
import type { TrialModel } from '../scripts/trialInput'

const props = defineProps<{ deployment: ModelDeployment }>()
const signature = ref<TrialModel | null>(null)
const input = ref('')
const result = ref('')
const error = ref('')
const loading = ref(false)
const running = ref(false)
const signatureRead = useRacedFetch()
const inference = useRacedFetch()
const unavailable = computed(
  () => !props.deployment.is_enabled || !props.deployment.is_servable,
)
const parsed = computed(() =>
  parseTrialRows(input.value, props.deployment.max_rows_per_call),
)
const canRun = computed(
  () =>
    !unavailable.value &&
    signature.value !== null &&
    !loading.value &&
    !running.value &&
    parsed.value.rows !== null,
)

async function load(): Promise<void> {
  inference.cancel()
  signatureRead.cancel()
  signature.value = null
  result.value = ''
  error.value = ''
  input.value = ''
  running.value = false
  loading.value = false
  if (unavailable.value) return
  loading.value = true
  await signatureRead.run(
    (signal) => getOpenModelSignature(props.deployment.code, signal),
    {
      ok: (raw) => {
        const model = readTrialModel(raw)
        signature.value = model
        input.value = trialExample(model)
      },
      fail: (caught) => {
        error.value =
          caught instanceof Error ? caught.message : describeError(caught)
      },
      settled: () => {
        loading.value = false
      },
    },
  )
}

async function run(): Promise<void> {
  const model = signature.value
  const rows = parsed.value.rows
  if (!canRun.value || !model || !rows) return
  running.value = true
  error.value = ''
  result.value = ''
  await inference.run(
    (signal) =>
      callOpenModel(props.deployment.code, model.action, rows, signal),
    {
      ok: (value) => {
        result.value = JSON.stringify(value, null, 2)
      },
      fail: (caught) => {
        error.value = describeError(caught)
      },
      settled: () => {
        running.value = false
      },
    },
  )
}

watch(
  () =>
    [
      props.deployment.code,
      props.deployment.model_version_id,
      props.deployment.is_enabled,
      props.deployment.is_servable,
    ].join(':'),
  () => void load(),
  { immediate: true },
)
onBeforeUnmount(() => {
  signatureRead.cancel()
  inference.cancel()
})
</script>

<template>
  <section class="flex flex-col gap-3" aria-label="在线试算">
    <h4 class="font-semibold">在线试算</h4>
    <p class="text-text-secondary">
      使用当前登录账号运行，计入该账号在此部署上的调用配额。请将示例中的 null
      替换为实际输入。
    </p>
    <DtNotice v-if="unavailable" intent="warning">{{
      deployment.is_enabled
        ? deployment.unservable_reason || '此模型版本不可服务，暂不能试算。'
        : '此服务已停用，启用后才能试算。'
    }}</DtNotice>
    <DtSpinner v-else-if="loading" />
    <template v-if="signature">
      <p class="font-mono text-text-secondary">
        POST /api/v1/platform/open-models/{{ deployment.code }}:{{
          signature.action
        }}
      </p>
      <ul
        class="flex flex-wrap gap-x-4 gap-y-1 text-text-secondary"
        aria-label="输入字段"
      >
        <li v-for="field in signature.inputs" :key="field.key">
          {{ field.label }} · {{ field.key }} · {{ field.dtype
          }}{{ field.unit ? ` / ${field.unit}` : '' }} ·
          {{ field.required ? '必填' : '可缺省' }}
        </li>
      </ul>
      <DtNotice v-if="signature.requiresTimestamp" intent="info"
        >每行还需提供 __ts__，格式为 UTC RFC3339 时间，例如
        2026-10-30T00:00:00Z。</DtNotice
      >
      <DtTextarea
        v-model="input"
        label="试算输入 JSON"
        :rows="7"
        :maxlength="200000"
        :disabled="running"
      />
      <DtNotice v-if="parsed.error" intent="warning">{{
        parsed.error
      }}</DtNotice>
    </template>
    <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>
    <div class="flex gap-2">
      <DtButton size="sm" :disabled="!canRun" @click="void run()">{{
        running ? '正在试算…' : '运行试算'
      }}</DtButton>
      <DtButton
        v-if="error && !signature"
        size="sm"
        variant="ghost"
        @click="void load()"
        >重新读取签名</DtButton
      >
    </div>
    <pre
      v-if="result"
      class="max-h-72 overflow-auto rounded-md bg-surface-sunken p-3 text-compact"
      aria-label="试算结果"
    ><code>{{ result }}</code></pre>
  </section>
</template>
