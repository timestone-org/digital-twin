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
import type { TwinConfig, TwinDistanceRef, Vec3 } from '@dt/twin-config'
import { DEFAULT_CAMERA_FOV } from '@dt/twin-config'
import { DtButton, DtNotice, DtSpinner } from '@dt/ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { targetFrameVars } from '../scripts/targetFrame'
import type { TwinSelection } from '../scripts/types'

const props = defineProps<{
  /** ⚠ 必须是 `normalizeTwinConfig` 的输出：视口按引用比对，就地改字段不会重绘。 */
  config: TwinConfig
  selection: TwinSelection | null
  pickMode: TwinPickMode
  /** 覆盖拾取提示条的文案；不给就按 `pickMode` 用缺省的两句。 */
  pickHint?: string | undefined
  /** 坐标轴手柄的模式；箭头与钉死朝向的信息牌用得上 `rotate`。 */
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
  /**
   * 当前坐标基准的原点（世界坐标）。
   * ⚠ 右栏的坐标框必须拿它换算：视口里的参考轴已经挪到基准原点上，
   * 右栏不跟着换的话两处对不上，且两处都不报错。
   */
  frameOrigin: [Vec3]
  /** 漫游预览开停；用户一碰镜头它会自己停，面板上的按钮要跟着回落。 */
  roamPreview: [boolean]
  /** 用户拖坐标轴手柄改了某个实体的位置 / 朝向。 */
  entityTransform: [GizmoChange]
  /** 手柄松手了；宿主据此把这一次拖动合成一条撤销。 */
  entityTransformEnd: []
  /** 选中部件后按住 Shift 点选或框选拿到的模型节点名。 */
  marqueeNodes: [readonly string[]]
  /** 用户按 Esc 或点提示条上的取消，退出这一次拾取。 */
  cancelPick: []
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
  if (props.pickMode === null) return ''
  if (props.pickHint !== undefined) return props.pickHint
  if (props.pickMode === 'node') return '点模型上的部件，取它的节点名'
  return '点模型表面或地面，取那个点的坐标'
})

/** 拾取途中按 Esc 也能退出来，不用非得找到那个取消按钮。 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.pickMode !== null) emit('cancelPick')
}
/** 按目标格子的宽高比留边；没给尺寸就铺满。 */
const frameVars = computed(() => targetFrameVars(props.targetSize))

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

/**
 * 按参考系量当前相机离选中实体多远；右栏的距离字段「量当前距离」用。
 * @param ref 距离参考系
 */
function measureDistance(ref: TwinDistanceRef): number | null {
  return scene?.measureDistance(ref) ?? null
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
      frameOrigin: (value) => emit('frameOrigin', value),
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
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
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

/** 视口的宿主元素；助手截图拿它当截图根。 */
function stageEl(): HTMLElement | null {
  return containerRef.value
}

defineExpose({
  focus,
  snapshot,
  measureDistance,
  playRoamPreview,
  stopRoamPreview,
  stageEl,
})
</script>

<template>
  <div class="twin-viewport__stage">
    <div
      ref="containerRef"
      class="twin-viewport"
      :class="{ 'twin-viewport--framed': frameVars !== undefined }"
      :style="[backgroundStyle, frameVars]"
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
      <div v-if="pickHint !== ''" class="twin-viewport__pick">
        <span>{{ pickHint }}</span>
        <DtButton
          class="twin-viewport__pick-cancel"
          variant="ghost"
          size="sm"
          @click="emit('cancelPick')"
        >
          取消
        </DtButton>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
// 舞台把视口居中；视口自己按目标格子的宽高比留边。
// ⚠ `container-type` 不是装饰：比例框用 cqw/cqh 量的就是这块舞台，
// 去掉它以后框会按整个视口算大小，比例照样是错的
.twin-viewport__stage {
  container-type: size;
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
  // ⚠ 不许收缩：比例框已经把两条边都夹在可用范围内，再让 flex 压一次会把
  // 宽度压回去而高度纹丝不动，比例于是被悄悄改掉
  flex: none;
  width: 100%;
  height: 100%;
  overflow: hidden;

  // ⚠ 两条边同时夹住，不是「高度撑满、宽度按比例推」：推出来的宽度超过可用
  // 宽度时 flex 会把宽压回去而高纹丝不动，比例就被悄悄改掉了
  &--framed {
    width: min(
      100cqw,
      calc(100cqh * var(--twin-frame-w) / var(--twin-frame-h))
    );
    height: min(
      100cqh,
      calc(100cqw * var(--twin-frame-h) / var(--twin-frame-w))
    );
  }

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

  // ⚠ 容器不吃指针、取消按钮单独放行：提示条横在视口顶上，整条能点的话
  // 会挡住它底下那一小条模型
  &__pick {
    position: absolute;
    top: 8px;
    left: 50%;
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 4px 6px 4px 12px;
    font-size: 12px;
    color: var(--text-secondary);
    background: var(--surface-sunken);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-pill);
    transform: translateX(-50%);
    pointer-events: none;
    white-space: nowrap;
  }

  &__pick-cancel {
    pointer-events: auto;
  }
}
</style>
