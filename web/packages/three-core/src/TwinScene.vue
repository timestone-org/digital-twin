<script setup lang="ts">
/**
 * @fileoverview 孪生场景宿主：渲染循环、模型装载与进度、部件显隐、锚点、箭头、信息牌、能量流与场景特效。
 * ⚠ 本组件静态依赖整个 three，只能被异步加载（DASHBOARD_DESIGN §5.4）。
 * ⚠ 根元素上的 `tabindex` 不是装饰：没有它这个 div 收不到 keydown，视点的数字键
 * 快捷方式整片失效，而按钮照常显示——界面上看不出快捷键为什么不响应。
 */
import type {
  TwinAnchorValues,
  TwinArrowValues,
  TwinConfig,
  TwinFlowValues,
  TwinModalView,
  TwinPanelValues,
} from '@dt/twin-config'
import {
  EMPTY_ANCHOR_VALUES,
  EMPTY_ARROW_VALUES,
  EMPTY_FLOW_VALUES,
  EMPTY_PANEL_VALUES,
  defaultCameraOf,
} from '@dt/twin-config'
import type { Object3D } from 'three'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { createFrameClock } from './frameClock'
import { GroundGridLayer } from './groundGrid'
import TwinRoamControls from './TwinRoamControls.vue'
import { useRoamTour } from './useRoamTour'
import { SceneLayers, type SceneLayerValues } from './sceneLayers'
import { distanceContextOf } from './distanceContext'
import type { TwinPartClick } from './partPicking'
import TwinSceneOverlay from './TwinSceneOverlay.vue'
import TwinViewpointBar from './TwinViewpointBar.vue'
import { usePartClick } from './usePartClick'
import { useTwinModelLoad } from './useTwinModelLoad'
import { useViewpointSwitch } from './useViewpointSwitch'
import { EMPTY_NODE_INDEX, type NodeIndex } from './nodeIndex'
import {
  WEBGL_UNAVAILABLE_MESSAGE,
  applyCameraPose,
  applyModelPlacement,
  boundingDiagonal,
  createSceneCore,
  createWebGLRenderer,
  disposeScene,
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
  /**
   * 钻取取景；null / 不给 = 不动镜头。
   * ⚠ 只在它换引用时飞一次，不每帧套——套住的话镜头就转不动了。
   */
  focusView?: TwinModalView | null
}>()

/** 点中了某个部件，且通过了距离门禁。 */
const emit = defineEmits<{ partClick: [TwinPartClick] }>()

const containerRef = ref<HTMLDivElement | null>(null)

let core: SceneCore | null = null
let layers: SceneLayers | null = null
let groundGrid: GroundGridLayer | null = null
const clock = createFrameClock()
let nodeIndex: NodeIndex = EMPTY_NODE_INDEX
let observer: ResizeObserver | null = null
let frameHandle = 0

const model = useTwinModelLoad({
  core: () => core,
  asset: () => props.config.model.asset,
  parts: () => props.config.parts,
  onReady: (root, index) => {
    nodeIndex = index
    applyInitialPose(root)
    refreshLayers()
  },
})

usePartClick({
  element: () => containerRef.value,
  core: () => core,
  parts: () => layers?.parts ?? null,
  onPartClick: (part) => emit('partClick', part),
})
const roam = useRoamTour({
  core: () => core,
  config: () => props.config,
})
const viewpoints = useViewpointSwitch({
  element: () => containerRef.value,
  config: () => props.config,
  onSwitch: (camera) => {
    // 手动切视点即打断漫游：否则下一帧轨迹又把镜头拽走，看着像点了没反应
    roam.pause()
    if (core === null) return
    applyCameraPose(core, camera)
    core.controls.update()
  },
})

const anchors = computed(() => props.anchorValues ?? EMPTY_ANCHOR_VALUES)
const arrows = computed(() => props.arrowValues ?? EMPTY_ARROW_VALUES)
const panels = computed(() => props.panelValues ?? EMPTY_PANEL_VALUES)
const flows = computed(() => props.flowValues ?? EMPTY_FLOW_VALUES)
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

/** 一帧多少毫秒；帧钟给的是秒。 */
const MS_PER_S = 1000

function tick(now: number): void {
  if (core === null) return
  const delta = clock.tick(now)
  animate(delta)
  // ⚠ 用帧钟夹过的时长，不用 rAF 的原始时刻：切走标签页再回来那一帧有几十秒，
  // 直接算下去会一帧飞完整条轨迹
  roam.advance(delta * MS_PER_S)
  // ⚠ 每帧都要算：镜头一直在动，距离规则的成立与否随时在变
  layers?.applyDistanceRules(distanceContextOf(core))
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
  syncGroundGrid()
  layers?.build(props.config, liveValues(), nodeIndex)
  // ⚠ 建完立刻按当前机位算一次：等下一帧的话，配了近距隐藏的元素会先露一帧
  layers?.applyDistanceRules(distanceContextOf(core))
}

/** 把配置里的摆放落到模型上，并按新体量重算锚点小球尺寸。 */
function placeModel(): void {
  const root = model.root()
  if (root === null) return
  applyModelPlacement(root, props.config.model)
  layers?.setWorldScale(boundingDiagonal(root))
}

/**
 * 地面网格按开关建删，尺寸随模型体量。
 * ⚠ 不跟着 `placeModel` 走：那一支在没有模型时直接返回，而网格是独立于模型的
 * 参考面——没挑模型时打开开关也该画得出来。
 */
function syncGroundGrid(): void {
  const root = model.root()
  groundGrid?.sync(
    props.config.model.showGroundGrid,
    root === null ? 0 : boundingDiagonal(root),
  )
}

/**
 * 模型装好后的初始取景：有视点就用标了默认的那个（没标则用第一个），
 * 一个视点都没配才把整个模型框进画面。
 * ⚠ 只在装载时用一次，不跟着配置每次重算——否则用户在运行态转了镜头，
 * 任何一次配置变更都会把镜头拽回默认机位。
 */
function applyInitialPose(root: Object3D): void {
  if (core === null) return
  const camera = defaultCameraOf(props.config.cameras)
  if (camera === null) return frameObject(core, root)
  applyCameraPose(core, camera)
  core.controls.update()
}

onMounted(() => {
  const element = containerRef.value
  if (element === null) return
  const renderer = createWebGLRenderer()
  if (renderer === null) return model.fail(WEBGL_UNAVAILABLE_MESSAGE)
  core = createSceneCore({ container: element, renderer })
  layers = new SceneLayers(element)
  layers.addTo(core.scene)
  groundGrid = new GroundGridLayer(core.scene, element)
  syncGroundGrid()
  observer = new ResizeObserver(measure)
  observer.observe(element)
  measure()
  clock.reset()
  frameHandle = requestAnimationFrame(tick)
  // ⚠ 必须等 core 建好再装：漫游要往轨道控制器上挂监听，早一步挂不上去
  roam.attach()
  viewpoints.attach()
  void model.load()
})

onBeforeUnmount(() => {
  // ⚠ 先让在途装载作废再释放：晚一步回来的那次会往已 dispose 的场景里挂模型
  model.abort()
  cancelAnimationFrame(frameHandle)
  observer?.disconnect()
  observer = null
  viewpoints.detach()
  layers?.dispose()
  layers = null
  groundGrid?.dispose()
  groundGrid = null
  if (core !== null) disposeScene(core)
  core = null
  nodeIndex = EMPTY_NODE_INDEX
})

/** 把一个取景快照落到相机上。 */
function applyFocusView(view: TwinModalView | null | undefined): void {
  if (core === null || view === null || view === undefined) return
  applyCameraPose(core, view)
  core.controls.update()
}

watch(
  () => props.config.model.asset,
  () => void model.load(),
)
watch(() => props.focusView, applyFocusView)
watch(() => props.config, refreshLayers)
watch(liveValues, (values) => layers?.setValues(values))
</script>

<template>
  <div
    ref="containerRef"
    class="twin-scene"
    tabindex="-1"
    :style="backgroundStyle"
  >
    <TwinSceneOverlay
      :status="model.status.value"
      :progress-percent="model.progressPercent.value"
      :error-message="model.errorMessage.value"
      :missing-nodes="model.missingNodes.value"
    />
    <TwinViewpointBar
      v-if="viewpoints.items.value.length > 0"
      :items="viewpoints.items.value"
      :active-id="viewpoints.activeId.value"
      :mode="config.viewpoints.mode"
      :keyboard="config.viewpoints.keyboard"
      @pick="viewpoints.switchTo($event)"
    />
    <TwinRoamControls
      v-if="roam.showControls.value"
      :playing="roam.playing.value"
      @toggle="roam.toggle()"
      @next="roam.next()"
      @prev="roam.prev()"
    />
  </div>
</template>

<style scoped lang="scss">
.twin-scene {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
