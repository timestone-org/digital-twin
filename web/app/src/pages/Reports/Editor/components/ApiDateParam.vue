<script setup lang="ts">
/** @fileoverview 配置按报告期计算的年、月、日请求参数。 */
import { computed, ref } from 'vue'
import { DtButton, DtInput, DtNotice, DtSelect } from '@dt/ui'
import { dateToken, type DateUnit } from '../scripts/apiSourceForm'

const MAX_SHIFT = 1200
const emit = defineEmits<{ add: [name: string, token: string] }>()
const name = ref('')
const unit = ref<DateUnit>('month')
const shift = ref('0')
const layout = ref('')
const error = ref('')
const UNITS = [
  { value: 'year', label: '年' },
  { value: 'month', label: '月' },
  { value: 'day', label: '日' },
]
const LAYOUTS = [
  { value: '', label: '只取该单位（2026 / 11 / 06）' },
  { value: 'YYYY', label: '年 2026' },
  { value: 'YYYY-MM', label: '年-月 2026-11' },
  { value: 'YYYY-MM-DD', label: '年-月-日 2026-11-06' },
  { value: 'YYYYMM', label: '202611' },
  { value: 'YYYYMMDD', label: '20261106' },
  { value: 'YYYY年M月', label: '2026年11月' },
  { value: 'M', label: '月（不补零）11' },
]
const shiftNumber = computed(() => Number(shift.value))
const token = computed(() =>
  Number.isInteger(shiftNumber.value)
    ? dateToken(unit.value, shiftNumber.value, layout.value)
    : '',
)
function setUnit(value: string): void {
  if (value === 'year' || value === 'month' || value === 'day')
    unit.value = value
}
function add(): void {
  error.value = ''
  if (!name.value.trim()) {
    error.value = '请填写参数名'
    return
  }
  if (!token.value || Math.abs(shiftNumber.value) > MAX_SHIFT) {
    error.value = '偏移须为 -1200 到 1200 的整数'
    return
  }
  emit('add', name.value.trim(), token.value)
  name.value = ''
}
</script>
<template>
  <div class="flex flex-col gap-3 rounded border border-border-subtle p-3">
    <strong class="text-sm">日期参数</strong>
    <div class="dt-form-grid">
      <DtInput v-model="name" label="参数名" placeholder="month" />
      <DtSelect
        :model-value="unit"
        label="计算单位"
        :options="UNITS"
        @update:model-value="setUnit"
      />
      <DtInput
        v-model="shift"
        label="偏移量"
        hint="0 当前，-1 去年 / 上个月 / 前一天"
      />
      <DtSelect v-model="layout" label="输出格式" :options="LAYOUTS" />
    </div>
    <p class="text-sm text-secondary">
      以报告期起始日为“当前”，跨年、跨月按日历计算。 结果：<code
        v-text="token"
      />
    </p>
    <DtNotice v-if="error" intent="warning">{{ error }}</DtNotice>
    <DtButton size="sm" variant="outline" icon="plus" @click="add">
      加入参数
    </DtButton>
  </div>
</template>
