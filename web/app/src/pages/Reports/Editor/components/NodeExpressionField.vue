<script setup lang="ts">
/** @fileoverview 数字/条件文本的表达式输入：点选指标与常用句式，免手敲花括号。 */
import { computed } from 'vue'
import { DtButton, DtInput } from '@dt/ui'
import type { ReportMetric } from '@dt/contracts'
const props = defineProps<{
  modelValue: string
  metrics: ReportMetric[]
  conditional: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const names = computed(() => props.metrics.map((metric) => metric.name))
const templates = computed(() => {
  const [first, second] = names.value
  if (!first) return []
  const other = second ?? first
  return props.conditional
    ? [
        {
          label: '升高 / 降低',
          value: `IF({${first}}>{${other}}, '升高', '降低')`,
        },
        {
          label: '达标 / 未达标',
          value: `IF({${first}}>=0, '达标', '未达标')`,
        },
      ]
    : [
        { label: '直接显示', value: `{${first}}` },
        {
          label: '变化率 %',
          value: `({${first}}-{${other}})/{${other}}*100`,
        },
      ]
})
function append(text: string): void {
  const current = props.modelValue
  emit(
    'update:modelValue',
    current && !current.endsWith(' ') ? `${current} ${text}` : current + text,
  )
}
</script>
<template>
  <div class="dt-form-grid__wide flex flex-col gap-2">
    <DtInput
      :model-value="props.modelValue"
      label="表达式"
      size="sm"
      :hint="
        props.conditional
          ? '引号里写要显示的文字；引号里不要写花括号'
          : '指标写作 {指标名}，可加减乘除'
      "
      placeholder="IF({本期}>{上期}, '升高', '降低')"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <div
      v-if="names.length"
      class="flex flex-wrap items-center gap-1"
      role="group"
      aria-label="点选插入指标"
    >
      <span class="text-sm text-secondary">插入指标：</span>
      <DtButton
        v-for="name in names"
        :key="name"
        size="xs"
        variant="outline"
        @click="append(`{${name}}`)"
      >
        {{ name }}
      </DtButton>
    </div>
    <p v-else class="text-sm text-secondary">
      还没有指标：先在「报告数据 → 报告指标」里添加，再回来点选。
    </p>
    <div
      v-if="templates.length"
      class="flex flex-wrap items-center gap-1"
      role="group"
      aria-label="常用写法"
    >
      <span class="text-sm text-secondary">常用写法：</span>
      <DtButton
        v-for="item in templates"
        :key="item.label"
        size="xs"
        variant="ghost"
        @click="emit('update:modelValue', item.value)"
      >
        {{ item.label }}
      </DtButton>
    </div>
  </div>
</template>
