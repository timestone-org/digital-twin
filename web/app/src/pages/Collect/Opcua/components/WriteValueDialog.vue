<script setup lang="ts">
/**
 * @fileoverview 向现场下发一个写值。
 *
 * ⚠ 这是**真的往 PLC 写**，不是改配置。所以：
 * 1. 弹窗里必须把点位编码、寻址串与当前值一起摆出来——「写错了点位」这类事故
 *    的唯一防线就是下发前那一眼。
 * 2. 失败**绝不自动重试**：写超时不代表没写成功，重试可能向设备下发两次
 *    （runtime-resilience §2）。要重来只能由人再点一次。
 * 3. 幂等键在人点下「下发」的那一刻生成一次，重复点击复用同一个——手抖点两下
 *    只写一次，而换一个点位就是新的一次意图，键跟着换。
 */
import { computed, ref, watch } from 'vue'
import type { CollectPoint, PointSample } from '@dt/contracts'
import {
  DtButton,
  DtField,
  DtInput,
  DtModal,
  DtNotice,
  DtSelect,
  DtTag,
} from '@dt/ui'

import { newIdempotencyKey } from '@/api/idempotency'
import { formatSample } from '../scripts/liveFormat'

const props = defineProps<{
  modelValue: boolean
  point: CollectPoint | null
  /** 该点位此刻的读数，没有就是 undefined。 */
  sample: PointSample | undefined
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  write: [payload: { value: unknown; key: string }]
}>()

const BOOL_OPTIONS = [
  { value: 'true', label: '真（ON）' },
  { value: 'false', label: '假（OFF）' },
]

const draft = ref('')
const error = ref<string | null>(null)
/** 这一次下发意图的幂等键。换点位或重开弹窗就换一个。 */
const key = ref(newIdempotencyKey())

watch(
  () => [props.modelValue, props.point] as const,
  ([open]) => {
    if (!open) return
    draft.value = props.point?.data_type === 'bool' ? 'true' : ''
    error.value = null
    key.value = newIdempotencyKey()
  },
  { immediate: true },
)

const current = computed(() => formatSample(props.sample, props.point?.unit))

/**
 * 把输入框里的字符串解成要下发的值。
 * ⚠ 解不出来就报错，不做「猜一个」：把 `abc` 当 0 写下去，PLC 会照单全收。
 */
function parseValue(): { value: unknown } | { error: string } {
  const type = props.point?.data_type ?? 'string'
  const raw = draft.value.trim()
  if (type === 'bool') return { value: raw === 'true' }
  if (type === 'string') return { value: draft.value }
  if (raw === '') return { error: '请填写要下发的值' }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return { error: `「${raw}」不是一个数字` }
  if (type === 'int' && !Number.isInteger(parsed)) {
    return { error: '这是整数点位，请填整数' }
  }
  return { value: parsed }
}

function submit(): void {
  const result = parseValue()
  if ('error' in result) {
    error.value = result.error
    return
  }
  error.value = null
  emit('write', { value: result.value, key: key.value })
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    title="下发写值"
    width="30rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="point" class="flex flex-col gap-3">
      <DtNotice intent="warning" icon="alert-triangle">
        这会真的向现场设备写入。请先核对下面的点位与寻址串。
      </DtNotice>

      <dl class="m-0 grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt class="text-text-secondary">点位</dt>
        <dd class="m-0">
          {{ point.name }}
          <DtTag class="ml-1" mono size="sm">{{ point.code }}</DtTag>
        </dd>
        <dt class="text-text-secondary">寻址串</dt>
        <dd class="m-0 break-all font-mono text-xs">{{ point.address }}</dd>
        <dt class="text-text-secondary">当前值</dt>
        <dd class="m-0 font-mono">{{ current.text }}</dd>
      </dl>

      <DtNotice v-if="error" intent="danger" icon="alert-circle">
        {{ error }}
      </DtNotice>

      <DtField :label="`要写入的值（${point.data_type}）`">
        <DtSelect
          v-if="point.data_type === 'bool'"
          v-model="draft"
          :options="BOOL_OPTIONS"
        />
        <DtInput
          v-else
          v-model="draft"
          class="font-mono"
          :placeholder="point.data_type === 'string' ? '任意文本' : '数字'"
        />
      </DtField>
    </div>

    <template #footer>
      <DtButton variant="ghost" @click="emit('update:modelValue', false)">
        取消
      </DtButton>
      <DtButton intent="warning" @click="submit">下发</DtButton>
    </template>
  </DtModal>
</template>
