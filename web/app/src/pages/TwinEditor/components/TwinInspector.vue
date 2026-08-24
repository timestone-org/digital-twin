<script setup lang="ts">
/**
 * @fileoverview 右栏检查器的分派：按当前选中挑一种检查器画出来。
 *
 * ⚠ 一律只向上发 `patch`（一段 `Partial<TwinConfig>`），不发「改第几个的哪个字段」。
 * 每种实体在这里各自把整份数组重建一遍，类型才对得上；发通用的
 * 「kind + id + 新值」会让类型在泛型索引处塌成联合，只能靠断言糊过去。
 */
import type {
  TwinAnchor,
  TwinArrow,
  TwinCamera,
  TwinConfig,
  TwinFlowLink,
  TwinHierNode,
  TwinModelRef,
  TwinPanel,
  TwinPart,
  TwinRoamTour,
  TwinViewpointSwitcher,
  Vec3,
} from '@dt/twin-config'
import { DtEmpty } from '@dt/ui'
import { computed } from 'vue'

import type { GizmoMode } from '@dt/three-core'

import type { TwinFrameView } from '../scripts/coordFrame'
import type { TwinSelection } from '../scripts/types'
import AnchorInspector from './inspector/AnchorInspector.vue'
import ArrowInspector from './inspector/ArrowInspector.vue'
import CameraInspector from './inspector/CameraInspector.vue'
import FlowInspector from './inspector/FlowInspector.vue'
import HierNodeInspector from './inspector/HierNodeInspector.vue'
import ModelInspector from './inspector/ModelInspector.vue'
import PanelInspector from './inspector/PanelInspector.vue'
import PartInspector from './inspector/PartInspector.vue'
import RoamTourInspector from './inspector/RoamTourInspector.vue'
import ViewpointsInspector from './inspector/ViewpointsInspector.vue'

const props = defineProps<{
  config: TwinConfig
  selection: TwinSelection
  /** 模型里的全部节点名；空数组 = 模型还没加载。 */
  modelNodes: readonly string[]
  picking: boolean
  /** 视口里正在飞漫游预览。 */
  roamPreviewing: boolean
  /** 视口里坐标轴手柄当前的模式。 */
  gizmoMode: GizmoMode
  /** 当前坐标基准的原点（世界坐标），视口算出来的。 */
  frameOrigin: Vec3
}>()

const emit = defineEmits<{
  patch: [Partial<TwinConfig>]
  requestPick: ['node' | 'position']
  cancelPick: []
  captureCamera: [string]
  captureHierView: [string]
  previewRoam: []
  stopRoamPreview: []
  'update:gizmoMode': [GizmoMode]
}>()

/**
 * 摆放坐标框要用的基准。
 * ⚠ 档位从配置读、原点从视口来：`center` 那一档的原点是模型的世界包围盒中心，
 * 配置里没有这个数，也算不出来。
 */
const frame = computed<TwinFrameView>(() => ({
  mode: props.config.model.coordFrame,
  origin: props.frameOrigin,
}))

/** 选中的实体 id；单例段没有 id。 */
const selectedId = computed(() =>
  'id' in props.selection ? props.selection.id : '',
)

const part = computed(
  () => props.config.parts.find((item) => item.id === selectedId.value) ?? null,
)
const anchor = computed(
  () =>
    props.config.anchors.find((item) => item.id === selectedId.value) ?? null,
)
const camera = computed(
  () =>
    props.config.cameras.find((item) => item.id === selectedId.value) ?? null,
)
const panel = computed(
  () =>
    props.config.panels.find((item) => item.id === selectedId.value) ?? null,
)
const arrow = computed(
  () =>
    props.config.arrows.find((item) => item.id === selectedId.value) ?? null,
)
const flow = computed(
  () => props.config.flows.find((item) => item.id === selectedId.value) ?? null,
)
const hierNode = computed(
  () =>
    props.config.hierNodes.find((item) => item.id === selectedId.value) ?? null,
)

/** 按 id 换掉数组里的一项，整份数组重建。 */
function replaced<T extends { id: string }>(
  list: readonly T[],
  next: T,
): readonly T[] {
  return list.map((item) => (item.id === next.id ? next : item))
}

function writeModel(next: TwinModelRef): void {
  emit('patch', { model: next })
}
function writeViewpoints(next: TwinViewpointSwitcher): void {
  emit('patch', { viewpoints: next })
}
function writeRoamTour(next: TwinRoamTour): void {
  emit('patch', { roamTour: next })
}
function writePart(next: TwinPart): void {
  emit('patch', { parts: [...replaced(props.config.parts, next)] })
}
function writeAnchor(next: TwinAnchor): void {
  emit('patch', { anchors: [...replaced(props.config.anchors, next)] })
}
function writeCamera(next: TwinCamera): void {
  emit('patch', { cameras: [...replaced(props.config.cameras, next)] })
}
function writePanel(next: TwinPanel): void {
  emit('patch', { panels: [...replaced(props.config.panels, next)] })
}
function writeArrow(next: TwinArrow): void {
  emit('patch', { arrows: [...replaced(props.config.arrows, next)] })
}
function writeFlow(next: TwinFlowLink): void {
  emit('patch', { flows: [...replaced(props.config.flows, next)] })
}
function writeHierNode(next: TwinHierNode): void {
  emit('patch', { hierNodes: [...replaced(props.config.hierNodes, next)] })
}
</script>

<template>
  <div>
    <ModelInspector
      v-if="selection.kind === 'model'"
      :model-value="config.model"
      :frame-origin="frameOrigin"
      @update:model-value="writeModel"
    />
    <ViewpointsInspector
      v-else-if="selection.kind === 'viewpoints'"
      :model-value="config.viewpoints"
      :cameras="config.cameras"
      @update:model-value="writeViewpoints"
    />
    <RoamTourInspector
      v-else-if="selection.kind === 'roam'"
      :model-value="config.roamTour"
      :cameras="config.cameras"
      :previewing="roamPreviewing"
      @update:model-value="writeRoamTour"
      @preview="emit('previewRoam')"
      @stop-preview="emit('stopRoamPreview')"
    />
    <PartInspector
      v-else-if="part !== null"
      :model-value="part"
      :node-names="modelNodes"
      :hier-nodes="config.hierNodes"
      :picking="picking"
      @update:model-value="writePart"
      @request-pick-node="emit('requestPick', 'node')"
      @cancel-pick="emit('cancelPick')"
    />
    <AnchorInspector
      v-else-if="anchor !== null"
      :model-value="anchor"
      :frame="frame"
      :picking="picking"
      @update:model-value="writeAnchor"
      @request-pick-position="emit('requestPick', 'position')"
      @cancel-pick="emit('cancelPick')"
    />
    <CameraInspector
      v-else-if="camera !== null"
      :model-value="camera"
      :frame="frame"
      @update:model-value="writeCamera"
      @capture-current="emit('captureCamera', camera.id)"
    />
    <PanelInspector
      v-else-if="panel !== null"
      :model-value="panel"
      :frame="frame"
      :anchors="config.anchors"
      @update:model-value="writePanel"
    />
    <ArrowInspector
      v-else-if="arrow !== null"
      :model-value="arrow"
      :frame="frame"
      :picking="picking"
      :gizmo-mode="gizmoMode"
      @update:model-value="writeArrow"
      @request-pick-position="emit('requestPick', 'position')"
      @cancel-pick="emit('cancelPick')"
      @update:gizmo-mode="emit('update:gizmoMode', $event)"
    />
    <FlowInspector
      v-else-if="flow !== null"
      :model-value="flow"
      :anchors="config.anchors"
      @update:model-value="writeFlow"
    />
    <HierNodeInspector
      v-else-if="hierNode !== null"
      :model-value="hierNode"
      :nodes="config.hierNodes"
      :cameras="config.cameras"
      :node-names="modelNodes"
      :picking="picking"
      @update:model-value="writeHierNode"
      @request-pick-node="emit('requestPick', 'node')"
      @cancel-pick="emit('cancelPick')"
      @capture-view="emit('captureHierView', $event)"
    />
    <DtEmpty v-else title="选中的东西已经不在了" />
  </div>
</template>
