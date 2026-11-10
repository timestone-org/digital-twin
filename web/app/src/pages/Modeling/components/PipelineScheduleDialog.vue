<script setup lang="ts">
/** @fileoverview 单个工作流的周期训练与自动发布设置。 */
import type { ModelingSchedule } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtCheckbox,
  DtDateTimeInput,
  DtModal,
  DtNotice,
  DtNumberInput,
  DtPageState,
  useToast,
} from '@dt/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  getModelingSchedule,
  saveModelingSchedule,
} from '@/api/modelingWorkflow'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime } from '@/utils/datetime'

const props = defineProps<{ pipeline: { id: string; name: string } | null }>()
const emit = defineEmits<{ close: [] }>()
const auth = useAuthStore()
const toast = useToast()
const read = useRacedFetch()
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const schedule = ref<ModelingSchedule | null>(null)
const enabled = ref(false)
const interval = ref<number | undefined>(1440)
const autoPublish = ref(false)
const firstRun = ref('')
const firstRunAt = computed(() => firstRun.value || null)
const savedMessage = computed(() =>
  enabled.value ? '定时训练已保存' : '已暂停定时训练',
)
let isDisposed = false
const canPublish = computed(() => auth.can([PERMISSION_CODES.modelingPublish]))
/** 训练间隔的上下限（分钟）；与后端校验一致。 */
const MIN_INTERVAL = 5
const MAX_INTERVAL = 525600
const intervalError = computed(() => {
  const value = interval.value
  if (value === undefined) return '请填写训练间隔'
  if (!Number.isInteger(value)) return '训练间隔要填整数分钟'
  if (value < MIN_INTERVAL) return `最短 ${MIN_INTERVAL} 分钟`
  if (value > MAX_INTERVAL) return '最长一年（525600 分钟）'
  return ''
})
const isValid = computed(() => intervalError.value === '')

async function load(): Promise<void> {
  const pipeline = props.pipeline
  if (!pipeline) return
  loading.value = true
  error.value = ''
  schedule.value = null
  firstRun.value = ''
  await read.run((signal) => getModelingSchedule(pipeline.id, signal), {
    ok: (result) => {
      schedule.value = result
      enabled.value = result.is_enabled
      interval.value = result.interval_minutes
      autoPublish.value = result.auto_publish
    },
    fail: (caught) => {
      error.value = describeError(caught)
    },
    settled: () => {
      loading.value = false
    },
  })
}

function isCurrent(id: string): boolean {
  return !isDisposed && props.pipeline?.id === id
}

async function save(): Promise<void> {
  const pipeline = props.pipeline
  const current = schedule.value
  const minutes = interval.value
  if (
    !pipeline ||
    !current ||
    busy.value ||
    !isValid.value ||
    minutes === undefined
  )
    return
  busy.value = true
  error.value = ''
  try {
    await saveModelingSchedule(pipeline.id, {
      is_enabled: enabled.value,
      interval_minutes: minutes,
      auto_publish: autoPublish.value,
      expected_revision: current.revision,
      first_run_at: firstRunAt.value,
    })
    if (!isCurrent(pipeline.id)) return
    toast.success(savedMessage.value)
    emit('close')
  } catch (caught) {
    if (isCurrent(pipeline.id)) error.value = describeError(caught)
  } finally {
    if (!isDisposed) busy.value = false
  }
}
watch(
  () => props.pipeline?.id,
  () => {
    read.cancel()
    if (props.pipeline) void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  isDisposed = true
  read.cancel()
})
</script>

<template>
  <DtModal
    :model-value="pipeline !== null"
    :title="`${pipeline?.name ?? ''} · 定时训练`"
    width="46rem"
    :close-on-backdrop="!busy"
    @update:model-value="!busy && emit('close')"
  >
    <div class="flex flex-col gap-4">
      <DtPageState v-if="loading" :loading="true" :empty="false" />
      <template v-else-if="schedule">
        <DtCheckbox
          v-model="enabled"
          label="启用定时重新训练"
          :disabled="busy"
        />
        <DtNumberInput
          v-model="interval"
          label="训练间隔（分钟）"
          hint="最短 5 分钟；每日训练填 1440，每周训练填 10080。"
          :range="{ min: 1, max: MAX_INTERVAL, step: 1 }"
          :error="intervalError"
          :disabled="busy"
        />
        <DtDateTimeInput
          v-model="firstRun"
          label="指定首次训练时间（选填）"
          hint="按当前浏览器时区；留空按训练间隔安排下一次。"
          :disabled="busy"
        />
        <DtCheckbox
          v-model="autoPublish"
          label="训练成功后自动发布最新模型"
          :disabled="busy || !canPublish"
        />
        <DtNotice intent="info">
          {{
            autoPublish
              ? '训练成功并通过发布校验后更新当前模型；发布失败时保留现有模型。'
              : '训练成功后保留模型，由你选择何时发布。'
          }}
          有训练正在执行时跳过该次调度，避免同一工作流重复训练。
        </DtNotice>
        <p
          v-if="schedule.next_run_at"
          class="m-0 text-caption text-text-secondary"
        >
          当前下次训练：{{ formatDateTime(schedule.next_run_at) }}
        </p>
        <p
          v-if="schedule.last_run_at"
          class="m-0 text-caption text-text-secondary"
        >
          最近调度：{{ formatDateTime(schedule.last_run_at) }}
        </p>
        <DtNotice v-if="schedule.last_error" intent="warning">{{
          schedule.last_error
        }}</DtNotice>
      </template>
      <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>
      <DtButton
        v-if="!loading && !schedule"
        variant="ghost"
        @click="void load()"
        >重新加载</DtButton
      >
    </div>
    <template #footer>
      <DtButton variant="ghost" :disabled="busy" @click="emit('close')"
        >取消</DtButton
      >
      <DtButton
        :disabled="!schedule || loading || !isValid"
        :loading="busy"
        @click="void save()"
        >保存</DtButton
      >
    </template>
  </DtModal>
</template>
