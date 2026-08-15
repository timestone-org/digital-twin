<script setup lang="ts">
/**
 * @fileoverview 页面级设置面（未选中任何节点时的右栏）：基本信息、对齐吸附与
 * 虚拟栅格、全屏卡片外观缺省。改动全部上抛，持久化由页面统一走元数据轴。
 */
import type {
  CardChrome,
  DashboardNodePayload,
  InteractionRule,
} from '@dt/contracts'
import type { GetModuleManifest } from '@dt/runtime'
import { computed, ref } from 'vue'
import {
  DtInput,
  DtNumberInput,
  DtSegmented,
  DtSelect,
  DtSwitch,
  DtTextarea,
} from '@dt/ui'

import {
  GRID_COLS_MAX,
  GRID_COLS_MIN,
  GRID_MARGIN_MAX,
  GRID_MARGIN_MIN,
  GRID_ROWS_MAX,
  GRID_ROWS_MIN,
  SNAP_STEP_PRESETS,
  type EditorGridConfig,
  type SnapConfig,
} from '@/features/dashboard/canvasSnap'
import { parseInteractionRules } from '@/features/dashboard/interactionRules'
import type { EditorMetaDraft } from '../useEditorMeta'
import CardStyleFields from './CardStyleFields.vue'
import InteractionEditor from './InteractionEditor.vue'

const props = defineProps<{
  draft: EditorMetaDraft | null
  snap: SnapConfig
  grid: EditorGridConfig
  nodes: readonly DashboardNodePayload[]
  getManifest: GetModuleManifest
}>()

const emit = defineEmits<{
  'set-field': [
    key: 'name' | 'description' | 'designWidth' | 'designHeight',
    value: string | number | null,
  ]
  'set-snap': [patch: Partial<SnapConfig>]
  'set-grid': [patch: Partial<EditorGridConfig>]
  'set-card': [card: CardChrome]
  'set-interactions': [rules: InteractionRule[]]
}>()

const PANEL_TABS = [
  { value: 'page', label: '页面' },
  { value: 'interaction', label: '联动' },
]
const panelTab = ref('page')

const rules = computed(() =>
  props.draft === null ? [] : parseInteractionRules(props.draft.chromeJson),
)

const SNAP_MODES = [
  { value: 'grid', label: '栅格线' },
  { value: 'px', label: '像素步进' },
]

const STEP_OPTIONS = SNAP_STEP_PRESETS.map((step) => ({
  value: String(step),
  label: `${step}px`,
}))

function onDesignWidth(value: number | undefined): void {
  if (typeof value === 'number') emit('set-field', 'designWidth', value)
}

function onDesignHeight(value: number | undefined): void {
  if (typeof value === 'number') emit('set-field', 'designHeight', value)
}

function onCols(value: number | undefined): void {
  if (typeof value === 'number') emit('set-grid', { cols: value })
}

function onRows(value: number | undefined): void {
  if (typeof value === 'number') emit('set-grid', { rows: value })
}

function onMargin(value: number | undefined): void {
  if (typeof value === 'number') {
    emit('set-grid', { marginX: value, marginY: value })
  }
}

function onStep(value: string): void {
  emit('set-snap', { step: Number(value) })
}

function onDescription(value: string): void {
  emit('set-field', 'description', value === '' ? null : value)
}

function onMode(value: string): void {
  emit('set-snap', { mode: value === 'px' ? 'px' : 'grid' })
}

/** 全屏卡片缺省住在 chromeJson.card；缺席给空袋。 */
function cardOf(draft: EditorMetaDraft | null): CardChrome {
  const raw = draft?.chromeJson.card
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw
    : {}
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <DtSegmented
      v-model="panelTab"
      :options="PANEL_TABS"
      size="sm"
      block
      variant="tabs"
      aria-label="页面设置分页"
    />
    <InteractionEditor
      v-if="panelTab === 'interaction'"
      class="min-h-0 flex-1 overflow-y-auto pr-1"
      :rules="rules"
      :nodes="nodes"
      :get-manifest="getManifest"
      @update:rules="emit('set-interactions', $event)"
    />
    <div v-else class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      <section v-if="draft" class="flex flex-col gap-2">
        <p class="dt-chrome__heading">基本</p>
        <DtInput
          size="sm"
          label="名称"
          :model-value="draft.name"
          data-test="chrome-name"
          @update:model-value="emit('set-field', 'name', $event)"
        />
        <DtTextarea
          size="sm"
          label="描述"
          :model-value="draft.description ?? ''"
          :rows="2"
          data-test="chrome-description"
          @update:model-value="onDescription"
        />
        <div class="grid grid-cols-2 gap-2">
          <DtNumberInput
            size="sm"
            label="设计宽度"
            :model-value="draft.designWidth"
            :min="320"
            data-test="chrome-design-width"
            @update:model-value="onDesignWidth"
          />
          <DtNumberInput
            size="sm"
            label="设计高度"
            :model-value="draft.designHeight"
            :min="240"
            data-test="chrome-design-height"
            @update:model-value="onDesignHeight"
          />
        </div>
      </section>

      <section class="flex flex-col gap-2">
        <p class="dt-chrome__heading">对齐吸附</p>
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-text-secondary">启用吸附</span>
          <DtSwitch
            size="sm"
            :model-value="snap.enabled"
            data-test="chrome-snap-enabled"
            @update:model-value="emit('set-snap', { enabled: $event })"
          />
        </div>
        <DtSegmented
          size="sm"
          :model-value="snap.mode"
          :options="SNAP_MODES"
          data-test="chrome-snap-mode"
          @update:model-value="onMode"
        />
        <DtSelect
          v-if="snap.mode === 'px'"
          size="sm"
          label="步进"
          :model-value="String(snap.step)"
          :options="STEP_OPTIONS"
          data-test="chrome-snap-step"
          @update:model-value="onStep"
        />
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-text-secondary">智能参考线</span>
          <DtSwitch
            size="sm"
            :model-value="snap.guides"
            data-test="chrome-snap-guides"
            @update:model-value="emit('set-snap', { guides: $event })"
          />
        </div>
        <div v-if="snap.mode === 'grid'" class="grid grid-cols-3 gap-2">
          <DtNumberInput
            size="sm"
            label="列数"
            :model-value="grid.cols"
            :min="GRID_COLS_MIN"
            :max="GRID_COLS_MAX"
            data-test="chrome-grid-cols"
            @update:model-value="onCols"
          />
          <DtNumberInput
            size="sm"
            label="行数"
            :model-value="grid.rows"
            :min="GRID_ROWS_MIN"
            :max="GRID_ROWS_MAX"
            data-test="chrome-grid-rows"
            @update:model-value="onRows"
          />
          <DtNumberInput
            size="sm"
            label="边距"
            :model-value="grid.marginX"
            :min="GRID_MARGIN_MIN"
            :max="GRID_MARGIN_MAX"
            data-test="chrome-grid-margin"
            @update:model-value="onMargin"
          />
        </div>
      </section>

      <section class="flex min-h-0 flex-col gap-2">
        <p class="dt-chrome__heading">卡片外观缺省</p>
        <!-- 模块可在自己的属性面板逐个覆盖；这里改的是全屏兜底 -->
        <CardStyleFields
          :model-value="cardOf(draft)"
          @update:model-value="emit('set-card', $event)"
        />
      </section>
    </div>
  </div>
</template>

<style scoped>
.dt-chrome__heading {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
  text-transform: uppercase;
}
</style>
