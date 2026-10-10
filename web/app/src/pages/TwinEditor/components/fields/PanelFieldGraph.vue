<script setup lang="ts">
/**
 * @fileoverview 信息牌字段的画法、量程、阈值与设备状态映射。
 */
import {
  PANEL_FIELD_KINDS,
  DEFAULT_PANEL_STATE,
  TWIN_PANEL_TONES,
  panelKindUsesRange,
  panelKindUsesSeries,
  panelKindUsesState,
  type TwinPanelField,
  type TwinPanelFieldKind,
  type TwinPanelLevel,
  type TwinPanelTone,
} from '@dt/twin-config'
import { DtButton, DtField, DtNumberInput, DtSelect } from '@dt/ui'
import { computed } from 'vue'

import PanelFieldState from './PanelFieldState.vue'

const props = defineProps<{ field: TwinPanelField }>()

const emit = defineEmits<{ update: [patch: Partial<TwinPanelField>] }>()

const KIND_LABELS: Readonly<Record<TwinPanelFieldKind, string>> = {
  text: '文本',
  hero: '大字主指标',
  bar: '量程进度条',
  gauge: '环形仪表',
  sparkline: '迷你趋势线',
  bars: '迷你柱群',
  dot: '状态灯',
  status: '状态徽标',
  switch: '开关指示',
  delta: '升降角标',
}
const TONE_LABELS: Readonly<Record<TwinPanelTone, string>> = {
  accent: '主题色',
  success: '正常',
  warning: '预警',
  danger: '危险',
}

/** 阈值档上限，与归一化那边同一个数。 */
const MAX_LEVELS = 6

const kindOptions = PANEL_FIELD_KINDS.map((value) => ({
  value,
  label: KIND_LABELS[value],
}))
const toneOptions = TWIN_PANEL_TONES.map((value) => ({
  value,
  label: TONE_LABELS[value],
}))

const usesRange = computed(() => panelKindUsesRange(props.field.kind))
const usesSeries = computed(() => panelKindUsesSeries(props.field.kind))
const usesState = computed(() => panelKindUsesState(props.field.kind))

/** 量程颠倒时图形画不出来，会退回纯文本——这一档必须当场说。 */
const badRange = computed(
  () => usesRange.value && props.field.max <= props.field.min,
)

function writeKind(next: string): void {
  const kind = PANEL_FIELD_KINDS.find((item) => item === next)
  if (kind === undefined) return
  if (panelKindUsesState(kind) && props.field.state === undefined) {
    emit('update', { kind, state: { ...DEFAULT_PANEL_STATE } })
    return
  }
  emit('update', { kind })
}

function writeLevels(levels: TwinPanelLevel[]): void {
  emit('update', { levels })
}

/** 档内不重名的新 id。 */
function freshLevelId(): string {
  const taken = new Set(props.field.levels.map((level) => level.id))
  let serial = props.field.levels.length + 1
  while (taken.has(`level-${serial}`)) serial += 1
  return `level-${serial}`
}

function addLevel(): void {
  writeLevels([
    ...props.field.levels,
    { id: freshLevelId(), at: props.field.max, tone: 'warning' },
  ])
}

function patchLevel(id: string, patch: Partial<TwinPanelLevel>): void {
  writeLevels(
    props.field.levels.map((level) =>
      level.id === id ? { ...level, ...patch } : level,
    ),
  )
}

function removeLevel(id: string): void {
  writeLevels(props.field.levels.filter((level) => level.id !== id))
}

function writeTone(id: string, next: string): void {
  const tone = TWIN_PANEL_TONES.find((item) => item === next)
  if (tone !== undefined) patchLevel(id, { tone })
}
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <DtField label="画法" hint="换画法不改行号，绑定不会跟着错位" size="sm">
      <DtSelect
        :model-value="field.kind"
        :options="kindOptions"
        aria-label="画法"
        size="sm"
        @update:model-value="writeKind"
      />
    </DtField>

    <template v-if="usesRange">
      <div class="grid grid-cols-2 gap-1.5">
        <DtNumberInput
          :model-value="field.min"
          label="量程下限"
          aria-label="量程下限"
          size="sm"
          :steppers="false"
          @update:model-value="emit('update', { min: $event ?? 0 })"
        />
        <DtNumberInput
          :model-value="field.max"
          label="量程上限"
          aria-label="量程上限"
          size="sm"
          :steppers="false"
          @update:model-value="emit('update', { max: $event ?? 0 })"
        />
      </div>
      <p v-if="badRange" class="text-xs text-state-danger">
        上限不大于下限，这个字段会退回纯文本。
      </p>
    </template>

    <p v-if="usesSeries" class="text-xs text-text-disabled">
      走势攒的是本次会话内收到的读数，不查历史库：刚打开大屏时图是空的。
    </p>

    <PanelFieldState
      v-if="usesState"
      :field="field"
      @update="emit('update', $event)"
    />

    <template v-else>
      <div
        v-for="level in field.levels"
        :key="level.id"
        class="flex items-center gap-1.5"
      >
        <span class="shrink-0 text-xs text-text-secondary">≥</span>
        <DtNumberInput
          class="min-w-0 flex-1"
          :model-value="level.at"
          aria-label="阈值"
          size="sm"
          :steppers="false"
          @update:model-value="patchLevel(level.id, { at: $event ?? 0 })"
        />
        <DtSelect
          class="min-w-0 flex-1"
          :model-value="level.tone"
          :options="toneOptions"
          aria-label="档位颜色"
          size="sm"
          @update:model-value="writeTone(level.id, $event)"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="danger"
          icon="trash"
          aria-label="删除阈值档"
          title="删除阈值档"
          @click="removeLevel(level.id)"
        />
      </div>

      <DtButton
        v-if="field.levels.length < MAX_LEVELS"
        variant="soft"
        size="sm"
        icon="plus"
        block
        @click="addLevel"
      >
        添加阈值档
      </DtButton>
      <!-- ⚠ 取的是满足条件里阈值最大的那一档，不是写在前面的那一档 -->
      <p v-if="field.levels.length > 1" class="text-xs text-text-disabled">
        读数同时满足几档时取阈值最大的那一档，与这里的先后无关。
      </p>
    </template>
  </div>
</template>
