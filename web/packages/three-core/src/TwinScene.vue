<script setup lang="ts">
/**
 * @fileoverview 孪生场景宿主：渲染循环、模型装载与进度、部件显隐、锚点、箭头、信息牌、能量流与场景特效。
 * ⚠ 本组件静态依赖整个 three，只能被异步加载（DASHBOARD_DESIGN §5.4）。
 */
import type {
  TwinAnchorValues,
  TwinArrowValues,
  TwinConfig,
  TwinFlowValues,
  TwinPanelValues,
} from '@dt/twin-config'
import {
  EMPTY_ANCHOR_VALUES,
  EMPTY_ARROW_VALUES,
  EMPTY_FLOW_VALUES,
  EMPTY_PANEL_VALUES,
} from '@dt/twin-config'
import { DtNotice, DtSpinner } from '@dt/ui'
import type { Object3D } from 'three'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { resolveTwinModelUrl } from './host'
import { createFrameClock } from './frameClock'
import { SceneLayers, type SceneLayerValues } from './sceneLayers'
import { loadTwinModel } from './modelLoader'
import {
  EMPTY_NODE_INDEX,
  applyPartVisibility,
  buildNodeIndex,
  unmatchedNodeNames,
  type NodeIndex,
} from './nodeIndex'
import {
  WEBGL_UNAVAILABLE_MESSAGE,
  applyModelPlacement,
  boundingDiagonal,
  createSceneCore,
  createWebGLRenderer,
  disposeScene,
  disposeSceneGraph,
  frameObject,
  renderScene,
  resizeScene,
  type SceneCore,
} from './sceneCore'

const props = defineProps<{
  /** ⚠ 必须是 `normalizeTwinConfig` 的输出：这里按引用比对，就地改字段不会重绘。 */
  config: TwinConfig
  anchorValues?: TwinAnchorValues
  arrowValues?: TwinArrowValues
  panelValues?: TwinPanelValues
  flowValues?: TwinFlowValues
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const status = ref<'empty' | 'loading' | 'ready' | 'error'>('empty')
const progressPercent = ref(0)
const errorMessage = ref('')
const missingNodes = ref<readonly string[]>([])

let core: SceneCore | null = null
/** 已挂上的模型根，配置改了要按新的摆放重置它。 */
let modelObject: Object3D | null = null
let layers: SceneLayers | null = null
const clock = createFrameClock()
let nodeIndex: NodeIndex = EMPTY_NODE_INDEX
let observer: ResizeObserver | null = null
let frameHandle = 0
let loadSeq = 0
let loadAbort: AbortController | null = null

const modelAsset = computed(() => props.config.model.asset)
const anchors = computed(() => props.anchorValues ?? EMPTY_ANCHOR_VALUES)
const arrows = computed(() => props.arrowValues ?? EMPTY_ARROW_VALUES)
const panels = computed(() => props.panelValues ?? EMPTY_PANEL_VALUES)
const flows = computed(() => props.flowValues ?? EMPTY_FLOW_VALUES)
const overlayMessage = computed(() =>
  status.value === 'error' ? errorMessage.value : '未选择模型',
)
const progressText = computed(() =>
  progressPercent.value > 0
    ? `模型加载中 ${progressPercent.value}%`
    : '模型加载中',
)
const missingText = computed(() => missingNodes.value.join('、'))
const backgroundStyle = computed(() => {
  const spec = props.config.model.background
  if (spec === '') return undefined
  return { background: spec.startsWith('--') ? `var(${spec})` : spec }
})

/** 把这一帧的时长交给需要动的那两层。 */
function animate(delta: number): void {
  if (delta <= 0) return
  layers?.update(delta)
}

function tick(now: number): void {
  if (core === null) return
  animate(clock.tick(now))
  renderScene(core)
  frameHandle = requestAnimationFrame(tick)
}

function measure(): void {
  const element = containerRef.value
  if (core === null || element === null) return
  resizeScene(core, element.clientWidth, element.clientHeight)
}

/** 当前这一拍的五路实时值。 */
function liveValues(): SceneLayerValues {
  return {
    anchors: anchors.value,
    arrows: arrows.value,
    panels: panels.value,
    flows: flows.value,
  }
}

function refreshLayers(): void {
  if (core === null) return
  core.controls.autoRotate = props.config.model.autoRotate
  // ⚠ 摆放要跟着配置重算：只在装载时应用的话，编辑器里改缩放/位移/旋转
  // 会一直到换模型才生效，中间那段是「调了没反应」
  placeModel()
  applyPartVisibility(nodeIndex, props.config.parts)
  layers?.build(props.config, liveValues())
}

/** 把配置里的摆放落到模型上，并按新体量重算锚点小球尺寸。 */
function placeModel(): void {
  if (modelObject === null) return
  applyModelPlacement(modelObject, props.config.model)
  layers?.setWorldScale(boundingDiagonal(modelObject))
}

function clearModel(): void {
  if (core !== null) disposeSceneGraph(core.modelRoot)
  modelObject = null
  nodeIndex = EMPTY_NODE_INDEX
  missingNodes.value = []
  errorMessage.value = ''
  status.value = 'empty'
}

function fail(message: string): void {
  clearModel()
  status.value = 'error'
  errorMessage.value = message
}

function mountModel(root: Object3D): void {
  if (core === null) return
  clearModel()
  modelObject = root
  applyModelPlacement(root, props.config.model)
  core.modelRoot.add(root)
  nodeIndex = buildNodeIndex(root)
  missingNodes.value = unmatchedNodeNames(nodeIndex, props.config.parts)
  frameObject(core, root)
  status.value = 'ready'
  refreshLayers()
}

function reportProgress(seq: number, loaded: number, total: number): void {
  if (seq !== loadSeq || total <= 0) return
  progressPercent.value = Math.round((loaded / total) * 100)
}

async function load(): Promise<void> {
  const mine = ++loadSeq
  loadAbort?.abort()
  const controller = new AbortController()
  loadAbort = controller
  const asset = modelAsset.value
  if (asset === '') return clearModel()
  const url = resolveTwinModelUrl(asset)
  if (url === '') return fail('模型地址解析失败：素材引用无效或宿主未注入')
  status.value = 'loading'
  progressPercent.value = 0
  try {
    const root = await loadTwinModel(url, {
      signal: controller.signal,
      onProgress: (loaded, total) => reportProgress(mine, loaded, total),
    })
    // ⚠ 慢的那次后返回时要连同它的 GPU 资源一起丢掉：只 return 是一次纯泄漏
    if (mine !== loadSeq) return disposeSceneGraph(root)
    mountModel(root)
  } catch (error) {
    if (mine !== loadSeq) return
    fail(error instanceof Error ? error.message : '模型加载失败')
  }
}

onMounted(() => {
  const element = containerRef.value
  if (element === null) return
  const renderer = createWebGLRenderer()
  if (renderer === null) return fail(WEBGL_UNAVAILABLE_MESSAGE)
  core = createSceneCore({ container: element, renderer })
  layers = new SceneLayers(element)
  layers.addTo(core.scene)
  observer = new ResizeObserver(measure)
  observer.observe(element)
  measure()
  clock.reset()
  frameHandle = requestAnimationFrame(tick)
  void load()
})

onBeforeUnmount(() => {
  // ⚠ 先让在途装载作废再释放：晚一步回来的那次会往已 dispose 的场景里挂模型
  loadSeq += 1
  loadAbort?.abort()
  loadAbort = null
  cancelAnimationFrame(frameHandle)
  observer?.disconnect()
  observer = null
  layers?.dispose()
  layers = null
  if (core !== null) disposeScene(core)
  core = null
  modelObject = null
  nodeIndex = EMPTY_NODE_INDEX
})

watch(modelAsset, () => void load())
watch(() => props.config, refreshLayers)
watch(liveValues, (values) => layers?.setValues(values))
</script>

<template>
  <div ref="containerRef" class="twin-scene" :style="backgroundStyle">
    <div v-if="status === 'loading'" class="twin-scene__overlay">
      <DtSpinner />
      <span class="twin-scene__progress">{{ progressText }}</span>
    </div>
    <div v-else-if="status !== 'ready'" class="twin-scene__overlay">
      <DtNotice :intent="status === 'error' ? 'danger' : 'neutral'">
        {{ overlayMessage }}
      </DtNotice>
    </div>
    <DtNotice
      v-if="missingNodes.length > 0"
      class="twin-scene__issue"
      intent="warning"
    >
      模型里没有这些部件节点：{{ missingText }}
    </DtNotice>
  </div>
</template>

<style scoped lang="scss">
.twin-scene {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;

  &__overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  &__progress {
    font-size: 12px;
    color: var(--text-secondary);
  }

  &__issue {
    position: absolute;
    right: 8px;
    bottom: 8px;
    left: 8px;
    justify-content: center;
  }
}
</style>
