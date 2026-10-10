<script setup lang="ts">
/** @fileoverview 信息牌状态字段的值映射、文案与语义配色配置。 */
import {
  DEFAULT_PANEL_STATE,
  TWIN_PANEL_STATE_TONES,
  panelStateItems,
  panelStateValuesConflict,
  type TwinPanelField,
  type TwinPanelState,
  type TwinPanelStateItem,
  type TwinPanelStateTone,
} from '@dt/twin-config'
import { DtButton, DtInput, DtNotice, DtSelect } from '@dt/ui'
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
const items = computed(() => panelStateItems(props.field.state))
const hasConflict = computed(() => panelStateValuesConflict(state.value))

function patch(next: Partial<TwinPanelState>): void {
  const states = next.states ?? items.value.map((item) => ({ ...item }))
  const on = states.find((item) => item.id === 'on')
  const off = states.find((item) => item.id === 'off')
  emit('update', {
    state: {
      ...state.value,
      ...next,
      states,
      ...(on === undefined
        ? {}
        : { onValue: on.value, onLabel: on.label, onTone: on.tone }),
      ...(off === undefined
        ? {}
        : { offValue: off.value, offLabel: off.label, offTone: off.tone }),
    },
  })
}

function patchItem(id: string, next: Partial<TwinPanelStateItem>): void {
  patch({
    states: items.value.map((item) =>
      item.id === id ? { ...item, ...next } : { ...item },
    ),
  })
}

function writeTone(id: string, next: string): void {
  const tone = TWIN_PANEL_STATE_TONES.find((item) => item === next)
  if (tone !== undefined) patchItem(id, { tone })
}

function freshStateId(): string {
  const taken = new Set(items.value.map((item) => item.id))
  let serial = items.value.length + 1
  while (taken.has(`state-${serial}`)) serial += 1
  return `state-${serial}`
}

function addItem(): void {
  patch({
    states: [
      ...items.value.map((item) => ({ ...item })),
      {
        id: freshStateId(),
        value: '',
        label: `状态${items.value.length + 1}`,
        tone: 'neutral',
      },
    ],
  })
}

function removeItem(id: string): void {
  patch({
    states: items.value
      .filter((item) => item.id !== id)
      .map((item) => ({ ...item })),
  })
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <p class="text-xs text-text-disabled">
      将设备值映射为状态文案；未匹配的值显示未知状态。
    </p>
    <div
      v-for="(item, index) in items"
      :key="item.id"
      class="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface-raised p-2"
    >
      <div class="flex items-center justify-between gap-1.5">
        <span class="text-xs text-text-secondary">状态 {{ index + 1 }}</span>
        <DtButton
          size="xs"
          variant="ghost"
          intent="danger"
          icon="trash"
          :aria-label="`删除状态${index + 1}`"
          :title="`删除状态${index + 1}`"
          @click="removeItem(item.id)"
        />
      </div>
      <div class="grid grid-cols-2 gap-1.5">
        <DtInput
          :model-value="item.value"
          :label="`状态${index + 1}值`"
          :aria-label="`状态${index + 1}值`"
          placeholder="如 0、1、2、running"
          size="sm"
          @update:model-value="patchItem(item.id, { value: $event })"
        />
        <DtInput
          :model-value="item.label"
          :label="`状态${index + 1}文案`"
          :aria-label="`状态${index + 1}文案`"
          placeholder="如 停止、运行、故障"
          size="sm"
          @update:model-value="patchItem(item.id, { label: $event })"
        />
      </div>
      <DtSelect
        :model-value="item.tone"
        :options="toneOptions"
        :label="`状态${index + 1}颜色`"
        :aria-label="`状态${index + 1}颜色`"
        size="sm"
        @update:model-value="writeTone(item.id, $event)"
      />
    </div>
    <DtButton
      variant="soft"
      size="sm"
      icon="plus"
      block
      aria-label="添加状态"
      @click="addItem"
    >
      添加状态
    </DtButton>
    <DtInput
      :model-value="state.unknownLabel"
      label="未知文案"
      aria-label="未知文案"
      placeholder="如 未知、待确认"
      size="sm"
      @update:model-value="patch({ unknownLabel: $event })"
    />
    <DtNotice v-if="items.length === 0" intent="warning" icon="alert-triangle">
      至少添加一个状态并填写状态值；当前所有值都显示未知状态。
    </DtNotice>
    <DtNotice v-else-if="hasConflict" intent="warning" icon="alert-triangle">
      状态值为空或重复，无法区分状态；请为每个状态填写不同的非空值。
    </DtNotice>
  </div>
</template>
