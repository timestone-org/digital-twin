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
} from '@dt/twin-config'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { GroundGridLayer } from './groundGrid'
import { ModelAnimations } from './modelAnimations'
import TwinRoamControls from './TwinRoamControls.vue'
import { useRoamTour } from './useRoamTour'
import { SceneLayers, type SceneLayerValues } from './sceneLayers'
import { distanceContextOf } from './distanceContext'
import type { TwinPartClick } from './partPicking'
import TwinSceneOverlay from './TwinSceneOverlay.vue'
import TwinSceneTools from './TwinSceneTools.vue'
import TwinStructurePanel from './TwinStructurePanel.vue'
import TwinViewpointBar from './TwinViewpointBar.vue'
import { usePartClick } from './usePartClick'
import { useRenderLoop } from './useRenderLoop'
import { useSceneCamera } from './useSceneCamera'
import { useSceneTools } from './useSceneTools'
import { useStructureTree } from './useStructureTree'
import { useTwinModelLoad } from './useTwinModelLoad'
import { useViewpointSwitch } from './useViewpointSwitch'
import { EMPTY_NODE_INDEX, type NodeIndex } from './nodeIndex'
import {
  WEBGL_UNAVAILABLE_MESSAGE,
  applyModelPlacement,
  boundingDiagonal,
  createSceneCore,
  createWebGLRenderer,
  disposeScene,
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
  /** 显示场景工具条（搜索定位 / 截图 / 测量 / 图例 / 剖切）。 */
  showSceneTools?: boolean
  /** 截图文件名用的标题。 */
  sceneTitle?: string
  /** 显示只读结构树：浏览层级、勾选显隐、点击定位。 */
  showStructureTree?: boolean
}>()

/** 点中了某个部件，且通过了距离门禁。 */
const emit = defineEmits<{ partClick: [TwinPartClick] }>()

const containerRef = ref<HTMLDivElement | null>(null)

let core: SceneCore | null = null
let layers: SceneLayers | null = null
let groundGrid: GroundGridLayer | null = null
let animations: ModelAnimations | null = null
let nodeIndex: NodeIndex = EMPTY_NODE_INDEX

/** 模型包围盒对角线；相机、图层与剪裁面都按它定尺度。 */
function modelSpan(): number {
  const root = model.root()
  return root === null ? 0 : boundingDiagonal(root)
}
const sceneCamera = useSceneCamera({
  core: () => core,
  config: () => props.config,
  span: modelSpan,
})

const model = useTwinModelLoad({
  core: () => core,
  asset: () => props.config.model.asset,
  parts: () => props.config.parts,
  onReady: (asset, index) => {
    nodeIndex = index
    // 动画属于模型，换模型整层重建；只换配置走 refreshLayers 里的 apply
    animations?.dispose()
    animations = new ModelAnimations(asset.root, asset.clips)
    animations.apply(props.config.model.animations)
    sceneCamera.applyInitial(asset.root)
    structure.rebuild()
    refreshLayers()
  },
})

const roam = useRoamTour({
  core: () => core,
  config: () => props.config,
  span: modelSpan,
})
const viewpoints = useViewpointSwitch({
  element: () => containerRef.value,
  config: () => props.config,
  onSwitch: (camera) => {
    // 手动切视点即打断漫游：否则下一帧轨迹又把镜头拽走，看着像点了没反应
    roam.pause()
    sceneCamera.applyCamera(camera)
  },
})

const tools = useSceneTools({
  core: () => core,
  element: () => containerRef.value,
  config: () => props.config,
  nodeIndex: () => nodeIndex,
  title: () => props.sceneTitle ?? '',
})

usePartClick({
  element: () => containerRef.value,
  core: () => core,
  parts: () => layers?.parts ?? null,
  onPartClick: (part) => emit('partClick', part),
  intercept: tools.interceptClick,
})
const structure = useStructureTree({
  core: () => core,
  enabled: () => props.showStructureTree === true,
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

/** 一帧多少毫秒；帧钟给的是秒。 */
const MS_PER_S = 1000

const loop = useRenderLoop({
  core: () => core,
  element: () => containerRef.value,
  onFrame: (deltaS) => {
    if (core !== null) layers?.update(deltaS, core.camera)
    if (deltaS > 0) animations?.update(deltaS)
    roam.advance(deltaS * MS_PER_S)
    // ⚠ 每帧都要算：镜头一直在动，距离规则的成立与否随时在变
    if (core !== null) layers?.applyDistanceRules(distanceContextOf(core))
  },
})

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
  animations?.apply(props.config.model.animations)
  layers?.build(props.config, liveValues(), nodeIndex)
  // ⚠ 建完立刻按当前机位算一次：等下一帧的话，配了近距隐藏的元素会先露一帧
  layers?.applyDistanceRules(distanceContextOf(core))
}

/**
 * 把摆放落到模型上，并按新体量重算锚点小球与地面网格。
 * ⚠ 网格那一支不能跟着「有没有模型」早退：它是独立于模型的参考面，
 * 没挑模型时打开开关也该画得出来。
 */
function placeModel(): void {
  const root = model.root()
  if (root !== null) {
    applyModelPlacement(root, props.config.model)
    layers?.setWorldScale(modelSpan())
  }
  groundGrid?.sync(props.config.model.showGroundGrid, modelSpan())
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
  placeModel()
  loop.start()
  // ⚠ 必须等 core 建好再装：漫游要往轨道控制器上挂监听，早一步挂不上去
  roam.attach()
  viewpoints.attach()
  void model.load()
})

/** 三层各自持有 GPU 资源，卸载时一个都不能漏。 */
function disposeLayers(): void {
  layers?.dispose()
  layers = null
  groundGrid?.dispose()
  groundGrid = null
  animations?.dispose()
  animations = null
}

onBeforeUnmount(() => {
  // ⚠ 先让在途装载作废再释放：晚一步回来的那次会往已 dispose 的场景里挂模型
  model.abort()
  viewpoints.detach()
  disposeLayers()
  if (core !== null) disposeScene(core)
  core = null
  nodeIndex = EMPTY_NODE_INDEX
})

watch(
  () => props.config.model.asset,
  () => void model.load(),
)
watch(() => props.focusView, sceneCamera.applyView)
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
    <TwinSceneTools v-if="showSceneTools === true" :tools="tools" />
    <TwinStructurePanel v-if="showStructureTree === true" :tree="structure" />
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
