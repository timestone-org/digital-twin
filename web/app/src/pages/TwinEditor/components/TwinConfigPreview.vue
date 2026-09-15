<script setup lang="ts">
/** @fileoverview 默认跟随配置的预览工作面，可切换整屏运行预览。 */
import type { BindingPayload, DashboardNodePayload } from '@dt/contracts'
import type { ModelAnimationEntry, TwinPreviewAction } from '@dt/three-core'
import { computeModuleValues, type BindingValueReader } from '@dt/runtime'
import {
  TWIN_VIEW_BINDINGS,
  detailPanelOf,
  twinSceneValues,
  type TwinConfig,
} from '@dt/twin-config'
import { DtButton, DtSegmented } from '@dt/ui'
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { animationTestConfig, configPreviewOf } from '../scripts/configPreview'
import type { TwinSelection } from '../scripts/types'
import TwinRuntimePreview from './TwinRuntimePreview.vue'
import TwinPreviewData from './TwinPreviewData.vue'
import TwinPreviewControls from './TwinPreviewControls.vue'
import {
  applyPreviewData,
  previewDataRows,
  type PreviewSample,
} from '../scripts/previewData'
import { roamPreviewOf } from '../scripts/previewContext'
const props = defineProps<{
  node: DashboardNodePayload | null
  config: TwinConfig
  selection: TwinSelection
  animation: ModelAnimationEntry | null
  testMode: 'live' | 'play' | 'pause' | 'reset'
  bindings: readonly BindingPayload[]
  readBinding: () => BindingValueReader
}>()
const Scene = defineAsyncComponent(
  async () => (await import('@dt/three-core')).TwinScene,
)
const emit = defineEmits<{ roamPlaying: [boolean] }>()
const PanelPreview = defineAsyncComponent(
  async () => (await import('@dt/three-core')).TwinPanelPreview,
)
const partMode = ref('model')
const segmentKey = ref('')
const progress = ref({ segmentIndex: 0, percent: 0, playing: false })
const result = ref('')
const request = ref<TwinPreviewAction | null>(null)
let sequence = 0
const simulation = ref(false)
const samples = ref<Record<string, PreviewSample>>({})
const contextSelection = computed<TwinSelection>(() =>
  props.animation === null ? props.selection : { kind: 'model' },
)
const rows = computed(() =>
  previewDataRows(props.config, props.selection, props.animation?.name ?? null),
)
const part = computed(() => {
  const selection = props.selection
  return selection.kind === 'parts'
    ? props.config.parts.find((item) => item.id === selection.id)
    : undefined
})
const card = computed(() => {
  if (props.animation !== null) return null
  if (part.value !== undefined && partMode.value === 'detail')
    return detailPanelOf(part.value)
  const selection = props.selection
  return selection.kind === 'panels'
    ? (props.config.panels.find((item) => item.id === selection.id) ?? null)
    : null
})
const nodes = computed(() =>
  partMode.value === 'click' ? undefined : preview.value.nodes,
)
const testLabel = computed(
  () =>
    ({ live: '配置控制', play: '播放', pause: '暂停', reset: '复位' })[
      props.testMode
    ],
)
function issue(kind: TwinPreviewAction['kind']): void {
  open.value = true
  mode.value = 'configure'
  request.value = { sequence: ++sequence, partId: part.value?.id ?? '', kind }
}
function onProgress(value: typeof progress.value): void {
  progress.value = value
  emit('roamPlaying', value.playing)
}
function stopTransient(): void {
  request.value = null
  emit('roamPlaying', false)
}
function clearSamples(): void {
  samples.value = {}
  simulation.value = false
}
function writeSample(value: { key: string; value: PreviewSample }): void {
  samples.value = { ...samples.value, [value.key]: value.value }
}
function selectSegment(value: string): void {
  segmentKey.value = value
  progress.value = { segmentIndex: 0, percent: 0, playing: false }
  issue('roam-stop')
}
function selectPartMode(value: string): void {
  partMode.value = value
  result.value = ''
}
function showPartMode(value: 'detail' | 'click'): void {
  partMode.value = value
  open.value = true
  mode.value = 'configure'
}
defineExpose({
  showPartMode,
  playRoam: () => issue('roam-play'),
  stopRoam: () => issue('roam-stop'),
})
const open = ref(true)
const wide = ref(false)
const mode = ref('configure')
const preview = computed(() =>
  configPreviewOf(props.config, props.selection, props.animation),
)
const config = computed(() => {
  let base = preview.value.config
  if (part.value !== undefined && partMode.value !== 'model')
    base = { ...base, parts: props.config.parts }
  if (part.value !== undefined && partMode.value === 'detail')
    base = {
      ...base,
      model: { ...base.model, autoRotate: part.value.detail.autoRotate },
    }
  if (contextSelection.value.kind === 'roam')
    base = roamPreviewOf(base, segmentKey.value)
  return animationTestConfig(
    base,
    props.animation?.name ?? null,
    props.testMode,
  )
})

const values = computed(() =>
  twinSceneValues(
    props.config,
    computeModuleValues({
      specs: TWIN_VIEW_BINDINGS,
      bindings: props.bindings,
      read: props.readBinding(),
    }).values,
  ),
)
const sceneValues = computed(() => {
  const live =
    props.testMode === 'live'
      ? values.value
      : { ...values.value, animations: {} }
  return simulation.value
    ? applyPreviewData(live, rows.value, samples.value)
    : live
})
const cardValues = computed(() =>
  part.value === undefined
    ? sceneValues.value.panels
    : sceneValues.value.partFields,
)
watch([() => props.selection, () => props.animation], () => {
  partMode.value = 'model'
  segmentKey.value = ''
  clearSamples()
  result.value = ''
  stopTransient()
})
watch([open, mode], () => {
  if (!open.value || mode.value !== 'configure') stopTransient()
})

const options = [
  { value: 'configure', label: '跟随配置' },
  { value: 'runtime', label: '整屏运行' },
]
watch(
  () => [props.selection, props.animation, props.testMode],
  () => {
    open.value = true
    mode.value = 'configure'
  },
)
</script>
<template>
  <div class="config-preview" :class="{ 'config-preview--wide': wide }">
    <DtButton v-if="!open" size="sm" @click="open = true">
      打开配置预览
    </DtButton>
    <section v-else class="config-preview__panel" aria-label="配置预览">
      <header class="flex items-center gap-1 border-b border-border-subtle p-1">
        <span class="min-w-0 flex-1 truncate text-xs" :title="preview.title">{{
          preview.title
        }}</span>
        <DtButton
          size="sm"
          variant="ghost"
          :aria-label="wide ? '缩小配置预览' : '放大配置预览'"
          @click="wide = !wide"
        >
          {{ wide ? '缩小' : '放大' }}
        </DtButton>
        <DtButton
          size="sm"
          variant="ghost"
          aria-label="关闭配置预览"
          @click="open = false"
        >
          关闭
        </DtButton>
      </header>
      <DtSegmented
        v-model="mode"
        :options="options"
        size="sm"
        block
        aria-label="预览模式"
      />
      <TwinPreviewControls
        v-if="mode === 'configure'"
        :config="props.config"
        :selection="contextSelection"
        :part-mode="partMode"
        :segment-key="segmentKey"
        :progress="progress"
        :result="result"
        @update:part-mode="selectPartMode"
        @update:segment-key="selectSegment"
        @action="issue"
      />
      <p
        v-if="mode === 'configure' && simulation"
        class="p-2 text-xs text-state-warning"
        role="status"
      >
        模拟数据预览 · 不会保存到大屏或写入设备
      </p>
      <div
        v-if="mode === 'configure'"
        v-show="partMode !== 'detail' || part?.detail.showModel !== false"
        class="config-preview__scene"
        :style="{ aspectRatio: `${node?.w || 16} / ${node?.h || 9}` }"
      >
        <Scene
          :key="simulation ? 'simulation' : 'realtime'"
          :config="config"
          :values="sceneValues"
          :preview-nodes="nodes"
          :preview-target="preview.target ?? null"
          :preview-action="request"
          :focus-view="preview.view"
          @preview-result="result = $event"
          @roam-progress="onProgress"
        />
      </div>
      <div
        v-if="mode === 'configure' && card"
        class="shrink-0 border-t border-border-subtle"
      >
        <header v-if="part" class="p-2 text-xs">
          <strong>{{ part.detail.title || part.name }}</strong>
          <p v-if="part.detail.subtitle">{{ part.detail.subtitle }}</p>
        </header>
        <PanelPreview
          :key="simulation ? 'simulation' : 'realtime'"
          :panel="card"
          :values="cardValues"
        />
        <p v-if="!card.fields.length" class="p-2 text-xs text-text-secondary">
          尚未配置读数字段
        </p>
      </div>
      <TwinPreviewData
        v-if="mode === 'configure'"
        v-model:enabled="simulation"
        :rows="rows"
        :values="values"
        :samples="samples"
        @write="writeSample"
        @clear="clearSamples"
      />
      <TwinRuntimePreview
        v-if="mode === 'runtime'"
        embedded
        :node="node"
        :config="props.config"
        :bindings="bindings"
        :read-binding="readBinding"
      />
      <p
        v-if="testMode !== 'live'"
        class="p-1 text-xs text-state-warning"
        role="status"
      >
        临时试播 · {{ testLabel }} · 不会写入设备
      </p>
    </section>
  </div>
</template>
<style scoped lang="scss">
.config-preview {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: absolute;
  right: 12px;
  bottom: 12px;
  width: min(400px, calc(100% - 24px));
  max-height: calc(100% - 24px);
  z-index: var(--z-sticky);
  &--wide {
    width: min(760px, calc(100% - 24px));
  }
  &__panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-base);
    box-shadow: var(--fx-shadow-menu);
  }
  &__scene {
    flex: none;
    width: 100%;
    max-height: 60vh;
  }
}
</style>
