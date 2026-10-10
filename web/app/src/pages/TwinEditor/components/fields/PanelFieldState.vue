<script setup lang="ts">
/** @fileoverview 信息牌状态字段的值映射、文案与语义配色配置。 */
import {
  DEFAULT_PANEL_STATE,
  TWIN_PANEL_STATE_TONES,
  panelStateValuesConflict,
  type TwinPanelField,
  type TwinPanelState,
  type TwinPanelStateTone,
} from '@dt/twin-config'
import { DtInput, DtNotice, DtSelect } from '@dt/ui'
import { computed } from 'vue'

const props = defineProps<{ field: TwinPanelField }>()
const emit = defineEmits<{ update: [patch: Partial<TwinPanelField>] }>()

const TONE_LABELS: Readonly<Record<TwinPanelStateTone, string>> = {
  neutral: '中性灰',
  accent: '主题色',
  success: '绿色',
  warning: '橙色',
  danger: '红色',
}
const toneOptions = TWIN_PANEL_STATE_TONES.map((value) => ({
  value,
  label: TONE_LABELS[value],
}))

const state = computed(() => props.field.state ?? DEFAULT_PANEL_STATE)
const hasConflict = computed(() => panelStateValuesConflict(state.value))

function patch(next: Partial<TwinPanelState>): void {
  emit('update', { state: { ...state.value, ...next } })
}

function writeTone(key: 'onTone' | 'offTone', next: string): void {
  const tone = TWIN_PANEL_STATE_TONES.find((item) => item === next)
  if (tone !== undefined) patch({ [key]: tone })
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <p class="text-xs text-text-disabled">
      将设备值映射为状态文案；未匹配的值显示未知状态。
    </p>
    <div
      class="grid grid-cols-2 gap-1.5 rounded border border-border-subtle bg-surface-raised p-2"
    >
      <span class="text-xs text-text-secondary">开启状态</span>
      <span class="text-xs text-text-secondary">关闭状态</span>
      <DtInput
        :model-value="state.onValue"
        label="开启值"
        aria-label="开启值"
        placeholder="如 1、true、ON"
        size="sm"
        @update:model-value="patch({ onValue: $event })"
      />
      <DtInput
        :model-value="state.offValue"
        label="关闭值"
        aria-label="关闭值"
        placeholder="如 0、false、OFF"
        size="sm"
        @update:model-value="patch({ offValue: $event })"
      />
      <DtInput
        :model-value="state.onLabel"
        label="开启文案"
        aria-label="开启文案"
        placeholder="如 开启、运行、故障"
        size="sm"
        @update:model-value="patch({ onLabel: $event })"
      />
      <DtInput
        :model-value="state.offLabel"
        label="关闭文案"
        aria-label="关闭文案"
        placeholder="如 关闭、停止、正常"
        size="sm"
        @update:model-value="patch({ offLabel: $event })"
      />
      <DtSelect
        :model-value="state.onTone"
        :options="toneOptions"
        label="开启颜色"
        aria-label="开启颜色"
        size="sm"
        @update:model-value="writeTone('onTone', $event)"
      />
      <DtSelect
        :model-value="state.offTone"
        :options="toneOptions"
        label="关闭颜色"
        aria-label="关闭颜色"
        size="sm"
        @update:model-value="writeTone('offTone', $event)"
      />
    </div>
    <DtInput
      :model-value="state.unknownLabel"
      label="未知文案"
      aria-label="未知文案"
      placeholder="如 未知、待确认"
      size="sm"
      @update:model-value="patch({ unknownLabel: $event })"
    />
    <DtNotice v-if="hasConflict" intent="warning" icon="alert-triangle">
      开启值与关闭值相同或为空，无法区分状态；请填写两个不同的非空值。
    </DtNotice>
  </div>
</template>
