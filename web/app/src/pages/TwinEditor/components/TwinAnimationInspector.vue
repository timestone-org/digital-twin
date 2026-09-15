<script setup lang="ts">
/** @fileoverview 单个模型动画的播放规则、点位绑定与临时试播。 */
import type { BindingPayload } from '@dt/contracts'
import {
  animationCondition,
  normalizeAnimationControls,
  type TwinAnimationControl,
  type TwinConfig,
} from '@dt/twin-config'
import {
  DtButton,
  DtInput,
  DtNotice,
  DtNumberInput,
  DtSelect,
  DtSwitch,
} from '@dt/ui'
import { computed } from 'vue'
import InspectorSection from './fields/InspectorSection.vue'
const props = defineProps<{
  config: TwinConfig
  clip: string
  bindings: readonly BindingPayload[]
  value: unknown
  available: boolean
  isDirty: boolean
  testMode: 'live' | 'play' | 'pause' | 'reset'
}>()
const emit = defineEmits<{
  patch: [Partial<TwinConfig>]
  pick: [string]
  drop: [string]
  test: ['live' | 'play' | 'pause' | 'reset']
}>()
const control = computed(
  () =>
    props.config.model.animations.controls.find(
      (item) => item.clip === props.clip,
    ) ?? normalizeAnimationControls([{ clip: props.clip }])[0],
)
const rowIndex = computed(() =>
  props.config.model.animations.controls.findIndex(
    (item) => item.clip === props.clip,
  ),
)
const fieldKey = computed(() => `animationValues[${rowIndex.value}].value`)
const bound = computed(() =>
  props.bindings.find((item) => item.fieldKey === fieldKey.value),
)
const valueLabel = computed(() =>
  typeof props.value === 'number' ||
  typeof props.value === 'string' ||
  typeof props.value === 'boolean'
    ? String(props.value)
    : '暂无有效数据',
)
const status = computed(() => {
  const current = control.value
  if (!props.available) return '模型中找不到该动画'
  if (props.testMode !== 'live') return '临时试播中，尚未恢复配置控制'
  if (current?.mode !== 'point')
    return current?.mode === 'always' ? '固定播放' : '已关闭'
  const matched = animationCondition(current, props.value)
  return matched === null
    ? '数据未知，执行无数据策略'
    : matched
      ? '条件命中：播放'
      : '条件未命中：停止'
})
function write(patch: Partial<TwinAnimationControl>): void {
  const current = control.value
  if (current === undefined) return
  const controls = [...props.config.model.animations.controls]
  const next = { ...current, ...patch }
  if (rowIndex.value < 0) controls.push(next)
  else controls.splice(rowIndex.value, 1, next)
  emit('patch', {
    model: {
      ...props.config.model,
      animations: { ...props.config.model.animations, controls },
    },
  })
}
const modes = [
  { value: 'off', label: '关闭' },
  { value: 'always', label: '固定播放' },
  { value: 'point', label: '点位控制' },
]
const operators = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
]
const stops = [
  { value: 'pause', label: '暂停，保留当前位置' },
  { value: 'reset', label: '停止，复位到初始状态' },
]
function writeMode(value: string): void {
  if (value === 'off' || value === 'always' || value === 'point')
    write({ mode: value })
}
function writeOperator(value: string): void {
  const matched = normalizeAnimationControls([
    { clip: props.clip, operator: value },
  ])[0]
  if (matched !== undefined) write({ operator: matched.operator })
}
function writeStop(value: string, missing = false): void {
  if (value !== 'pause' && value !== 'reset') return
  write(missing ? { missing: value } : { stop: value })
}
</script>
<template>
  <div v-if="control" class="min-h-0 overflow-y-auto">
    <InspectorSection title="模型动画">
      <p class="break-all text-xs text-text-secondary">{{ clip }}</p>
      <DtInput
        :model-value="control.name"
        label="显示名称"
        size="sm"
        placeholder="留空使用模型动画名称"
        @update:model-value="write({ name: $event })"
      />
      <DtNotice v-if="!available" intent="warning">
        模型中已缺失此动画，原配置和绑定已保留。请恢复对应模型动画后再验证。
      </DtNotice>
      <DtSelect
        :model-value="control.mode"
        :options="modes"
        label="控制方式"
        size="sm"
        @update:model-value="writeMode"
      />
    </InspectorSection>
    <InspectorSection v-if="control.mode === 'point'" title="控制点位">
      <p class="break-all text-xs">{{ bound?.nodeKey ?? '尚未绑定点位' }}</p>
      <div class="flex flex-wrap gap-1">
        <DtButton size="sm" @click="emit('pick', fieldKey)">
          {{ bound ? '更换点位' : '选择点位' }}
        </DtButton>
        <DtButton
          v-if="bound"
          size="sm"
          variant="ghost"
          @click="emit('drop', fieldKey)"
        >
          解除绑定
        </DtButton>
      </div>
      <p class="text-xs">当前值：{{ valueLabel }}</p>
      <DtNotice v-if="isDirty" intent="info">
        新绑定保存后开始接收实时数据。
      </DtNotice>
      <DtSelect
        :model-value="control.operator"
        :options="operators"
        label="播放条件"
        size="sm"
        @update:model-value="writeOperator"
      />
      <DtNumberInput
        :model-value="control.threshold"
        label="比较值（布尔真=1，假=0）"
        size="sm"
        @update:model-value="write({ threshold: $event ?? 1 })"
      />
      <DtSelect
        :model-value="control.missing"
        :options="stops"
        label="无有效数据时"
        size="sm"
        @update:model-value="writeStop($event, true)"
      />
    </InspectorSection>
    <InspectorSection title="播放行为">
      <DtNumberInput
        :model-value="control.speed"
        :range="{ min: 0.05, max: 4, step: 0.05 }"
        label="速度倍率"
        size="sm"
        @update:model-value="write({ speed: $event ?? 1 })"
      />
      <DtSwitch
        :model-value="control.loop === 'repeat'"
        label="循环播放"
        size="sm"
        @update:model-value="write({ loop: $event ? 'repeat' : 'once' })"
      />
      <DtSelect
        :model-value="control.stop"
        :options="stops"
        label="条件不满足时"
        size="sm"
        @update:model-value="writeStop($event)"
      />
      <DtSwitch
        :model-value="control.restart"
        label="再次启动从头播放"
        size="sm"
        @update:model-value="write({ restart: $event })"
      />
    </InspectorSection>
    <InspectorSection title="验证动画">
      <p class="text-xs" role="status">{{ status }}</p>
      <div class="flex flex-wrap gap-1">
        <DtButton
          size="sm"
          :disabled="!available"
          @click="emit('test', 'play')"
        >
          单独试播
        </DtButton>
        <DtButton
          size="sm"
          :disabled="!available"
          @click="emit('test', 'pause')"
        >
          暂停
        </DtButton>
        <DtButton
          size="sm"
          :disabled="!available"
          @click="emit('test', 'reset')"
        >
          复位
        </DtButton>
        <DtButton size="sm" variant="ghost" @click="emit('test', 'live')">
          恢复配置控制
        </DtButton>
      </div>
      <p class="text-xs text-text-disabled">
        试播仅影响配置预览，不写入设备，也不保存播放状态。
      </p>
    </InspectorSection>
  </div>
</template>
