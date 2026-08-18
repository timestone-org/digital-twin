<script setup lang="ts">
/**
 * @fileoverview 孪生编辑器的 3D 视口：把命令式的 `EditorScene` 包成组件，
 * 并画出空态 / 加载中 / 出错的覆盖层与拾取模式的提示条。
 */
import {
  EditorScene,
  type EditorSceneStatus,
  type GizmoChange,
  type GizmoMode,
  type SceneLayerValues,
  type TwinCameraPose,
  type TwinPickMode,
} from '@dt/three-core'
import type { TwinConfig, Vec3 } from '@dt/twin-config'
import { DEFAULT_CAMERA_FOV } from '@dt/twin-config'
import { DtNotice, DtSpinner } from '@dt/ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { TwinSelection } from '../scripts/types'

const props = defineProps<{
  /** ⚠ 必须是 `normalizeTwinConfig` 的输出：视口按引用比对，就地改字段不会重绘。 */
  config: TwinConfig
  selection: TwinSelection | null
  pickMode: TwinPickMode
  /** 坐标轴手柄的模式；只有箭头用得上 `rotate`。 */
  gizmoMode?: GizmoMode
  /**
   * 这块孪生在大屏上占多大（设计像素）；给了就按它的宽高比留边。
   * ⚠ 不留边的话编辑视口与大屏格子的宽高比不同，相机 aspect 跟着不同，
   * 同一份配置在两边取景不一样——用户看到的是「牌与模型的大小对不上」。
   */
  targetSize?: { width: number; height: number } | undefined
  /**
   * 缝合好的五路实时值；不给就是一片占位符。
   * ⚠ 编辑视口显示的读数与大屏是同一条链路（同一个推送主题、同一份缝合），
   * 所以在这里核对过的对应关系，到大屏上就是那个结果。
   */
  values?: SceneLayerValues | undefined
}>()

const emit = defineEmits<{
  select: [TwinSelection | null]
  pickNode: [string]
  pickPosition: [Vec3]
  modelNodes: [readonly string[]]
  cameraChange: [TwinCameraPose]
  status: [EditorSceneStatus]
  /** 漫游预览开停；用户一碰镜头它会自己停，面板上的按钮要跟着回落。 */
  roamPreview: [boolean]
  /** 用户拖坐标轴手柄改了某个实体的位置 / 朝向。 */
  entityTransform: [GizmoChange]
  /** 手柄松手了；宿主据此把这一次拖动合成一条撤销。 */
  entityTransformEnd: []
  /** 按住 Shift 框选拿到的模型节点名。 */
  marqueeNodes: [readonly string[]]
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const status = ref<EditorSceneStatus>('empty')
const errorMessage = ref('')

// ⚠ 场景不进响应式：它是命令式对象，被代理一遍只会让 three 的内部结构在每一帧
// 白走一次依赖收集，而它的变化本来就不需要驱动模板
let scene: EditorScene | null = null

const overlayMessage = computed(() =>
  status.value === 'error' ? errorMessage.value : '未选择模型',
)
const pickHint = computed(() => {
  if (props.pickMode === 'node') return '点模型上的部件，取它的节点名'
  if (props.pickMode === 'position') return '点模型表面或地面，取世界坐标'
  return ''
})
/**
 * 按目标格子的宽高比留边；没给尺寸就铺满。
 * 编辑区左右都有面板、通常比大屏格子更宽，所以按高度撑满推宽度；
 * 真遇上更窄的编辑区时多出的部分由舞台裁掉，不会把画面挤没。
 */
const frameStyle = computed(() => {
  const size = props.targetSize
  if (size === undefined || size.width <= 0 || size.height <= 0)
    return undefined
  // ⚠ 高度撑满、宽度由比例推：两个方向都写 auto 的话，视口里只有绝对定位的
  // canvas、没有流内容，auto 会双双塌成 0——画面整个消失，且不报任何错
  return {
    width: 'auto',
    height: '100%',
    aspectRatio: `${size.width} / ${size.height}`,
  }
})

const backgroundStyle = computed(() => {
  const spec = props.config.model.background
  if (spec === '') return undefined
  return { background: spec.startsWith('--') ? `var(${spec})` : spec }
})

/** 状态与错误文案一起换，覆盖层才不会显示上一次的原因。 */
function applyStatus(next: EditorSceneStatus, message: string): void {
  status.value = next
  errorMessage.value = message
  emit('status', next)
}

/**
 * 把镜头飞到某个实体或部件上。
 * @param selection 要对焦的目标
 */
function focus(selection: TwinSelection): void {
  scene?.focus(selection)
}

/** 当前机位快照，视点检查器的「取当前机位」用。 */
function snapshot(): TwinCameraPose {
  return (
    scene?.snapshot() ?? {
      position: [0, 0, 0],
      target: [0, 0, 0],
      fov: DEFAULT_CAMERA_FOV,
    }
  )
}

onMounted(() => {
  const element = containerRef.value
  if (element === null) return
  scene = new EditorScene({
    container: element,
    config: props.config,
    on: {
      select: (value) => emit('select', value),
      pickNode: (value) => emit('pickNode', value),
      pickPosition: (value) => emit('pickPosition', value),
      modelNodes: (value) => emit('modelNodes', value),
      cameraChange: (value) => emit('cameraChange', value),
      status: applyStatus,
      roamPreview: (value) => emit('roamPreview', value),
      entityTransform: (change) => emit('entityTransform', change),
      entityTransformEnd: () => emit('entityTransformEnd'),
      marqueeNodes: (names) => emit('marqueeNodes', names),
    },
  })
  scene.setSelection(props.selection)
  scene.setPickMode(props.pickMode)
  // 挂载时视口已经错过了此前的每一次 watch，首帧值要在这里补一次
  if (props.values !== undefined) scene.setValues(props.values)
})

onBeforeUnmount(() => {
  scene?.dispose()
  scene = null
})

watch(
  () => props.config,
  (value) => scene?.setConfig(value),
)
watch(
  () => props.selection,
  (value) => scene?.setSelection(value),
)
watch(
  () => props.pickMode,
  (value) => scene?.setPickMode(value),
)
watch(
  () => props.gizmoMode,
  (value) => scene?.setGizmoMode(value ?? 'translate'),
)
watch(
  () => props.values,
  (value) => {
    if (value !== undefined) scene?.setValues(value)
  },
)

/**
 * 按当前配置飞一遍漫游轨迹；可用站点不足两个时返回 false。
 * ⚠ 编辑视口只有这一个入口会自动移镜头，绝不跟着 `autoplay` 自己开播。
 */
function playRoamPreview(): boolean {
  return scene?.playRoamPreview() ?? false
}

/** 停下预览，镜头停在当前这一帧上。 */
function stopRoamPreview(): void {
  scene?.stopRoamPreview()
}

defineExpose({ focus, snapshot, playRoamPreview, stopRoamPreview })
</script>

<template>
  <div class="twin-viewport__stage">
    <div
      ref="containerRef"
      class="twin-viewport"
      :style="[backgroundStyle, frameStyle]"
    >
      <div v-if="status === 'loading'" class="twin-viewport__overlay">
        <DtSpinner />
        <span class="twin-viewport__hint">模型加载中</span>
      </div>
      <div v-else-if="status !== 'ready'" class="twin-viewport__overlay">
        <DtNotice :intent="status === 'error' ? 'danger' : 'neutral'">
          {{ overlayMessage }}
        </DtNotice>
      </div>
      <p v-if="pickHint !== ''" class="twin-viewport__pick">{{ pickHint }}</p>
    </div>
  </div>
</template>

<style scoped lang="scss">
// 舞台把视口居中；视口自己按目标格子的宽高比留边
// 舞台把视口居中；比例超出可用宽度时由它裁掉，不让画面挤没
.twin-viewport__stage {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--surface-sunken);
}

.twin-viewport {
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

  &__hint {
    font-size: 12px;
    color: var(--text-secondary);
  }

  &__pick {
    position: absolute;
    top: 8px;
    left: 50%;
    padding: 4px 12px;
    font-size: 12px;
    color: var(--text-secondary);
    background: var(--surface-sunken);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-pill);
    transform: translateX(-50%);
    pointer-events: none;
  }
}
</style>
