<script setup lang="ts">
/** @fileoverview 点位实时状态、采集配置与历史趋势的只读详情。 */
import { computed } from 'vue'
import type { CollectPoint, PointSample } from '@dt/contracts'
import {
  DtButton,
  DtField,
  DtLineChart,
  DtModal,
  DtNotice,
  DtSelect,
} from '@dt/ui'
import { formatTimestampMs } from '@/utils/datetime'
import { HISTORY_WINDOWS, usePointHistory } from '../scripts/usePointHistory'
import PointValueCell from './PointValueCell.vue'

const props = defineProps<{
  point: CollectPoint | null
  sample: PointSample | undefined
  stale: boolean
}>()
const emit = defineEmits<{ close: [] }>()
const pointRef = computed(() => props.point)
const history = usePointHistory(pointRef)
const numeric = computed(
  () =>
    props.point !== null && ['float', 'int'].includes(props.point.data_type),
)
const sampleTime = computed(() =>
  props.sample?.state === 'ok'
    ? formatTimestampMs(props.sample.timestampMs)
    : '—',
)
const aggregateOptions = [
  { value: 'avg', label: '平均值' },
  { value: 'max', label: '最大值' },
  { value: 'min', label: '最小值' },
]
</script>

<template>
  <DtModal
    :model-value="point !== null"
    :title="point?.name ?? '点位详情'"
    width="60rem"
    @update:model-value="emit('close')"
  >
    <div v-if="point" class="flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-3">
        <DtField label="当前读数"
          ><PointValueCell :sample="sample" :unit="point.unit" :stale="stale"
        /></DtField>
        <DtField label="完整采样时间"
          ><span class="text-sm">
            {{ sampleTime }}
          </span></DtField
        >
        <DtField label="历史配置"
          ><span class="text-sm">
            {{ point.archive_enabled ? '已开启记录' : '未开启记录' }}
          </span></DtField
        >
      </div>
      <dl class="grid grid-cols-[6rem_minmax(0,1fr)] gap-2 text-sm">
        <dt>编码</dt>
        <dd class="m-0 break-all font-mono">{{ point.code }}</dd>
        <dt>寻址串</dt>
        <dd class="m-0 break-all font-mono">{{ point.address }}</dd>
        <dt>描述</dt>
        <dd class="m-0">{{ point.description || '—' }}</dd>
        <dt>类型／单位</dt>
        <dd class="m-0">{{ point.data_type }} / {{ point.unit ?? '—' }}</dd>
        <dt>采样间隔</dt>
        <dd class="m-0">{{ point.sampling_interval_ms }} ms</dd>
        <dt>归档死区</dt>
        <dd class="m-0">{{ point.deadband }}</dd>
        <dt>归档心跳</dt>
        <dd class="m-0">{{ point.archive_max_interval_ms }} ms</dd>
      </dl>
      <DtNotice v-if="!point.archive_enabled" intent="info">
        当前未开启记录历史，仍可查看此前已保存的历史。
      </DtNotice>
      <template v-if="numeric">
        <div class="flex flex-wrap items-end gap-3">
          <DtSelect
            v-model="history.windowMinutes.value"
            :options="HISTORY_WINDOWS"
            label="历史范围"
          />
          <DtSelect
            v-model="history.aggregate.value"
            :options="aggregateOptions"
            label="统计方式"
          />
          <DtButton
            variant="outline"
            :loading="history.loading.value"
            @click="history.reload"
          >
            刷新历史
          </DtButton>
        </div>
        <DtNotice v-if="history.error.value" intent="danger">
          {{ history.error.value }}
        </DtNotice>
        <DtNotice v-if="history.result.value?.is_truncated" intent="warning">
          历史结果未完整返回，请缩小时间范围。
        </DtNotice>
        <DtLineChart
          :series="history.series.value"
          :loading="history.loading.value"
          aria-label="点位历史趋势"
        />
        <p class="m-0 text-xs text-text-secondary">
          趋势按
          {{ history.result.value?.interval ?? '时间桶' }}
          聚合；缺少读数的位置保持断档，不表示零值。开启记录不代表历史已经成功落库，请以查询结果为准。
        </p>
      </template>
      <DtNotice v-else intent="info">
        此点位为非数值类型，当前不绘制数值趋势。
      </DtNotice>
    </div>
  </DtModal>
</template>
