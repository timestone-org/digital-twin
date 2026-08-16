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
  type TwinCameraPose,
  type TwinPickMode,
} from '@dt/three-core'
import type { TwinConfig, Vec3 } from '@dt/twin-config'
import { DEFAULT_CAMERA_FOV } from '@dt/twin-config'
import { DtNotice, DtSpinner } from '@dt/ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { TwinSelection } from '../types'

const props = defineProps<{
  /** ⚠ 必须是 `normalizeTwinConfig` 的输出：视口按引用比对，就地改字段不会重绘。 */
  config: TwinConfig
  selection: TwinSelection | null
  pickMode: TwinPickMode
  /** 坐标轴手柄的模式；只有箭头用得上 `rotate`。 */
  gizmoMode?: GizmoMode
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
    },
  })
  scene.setSelection(props.selection)
  scene.setPickMode(props.pickMode)
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
  <div ref="containerRef" class="twin-viewport" :style="backgroundStyle">
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
</template>

<style scoped lang="scss">
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
