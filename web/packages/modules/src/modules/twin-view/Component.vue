<script setup lang="ts">
/**
 * @fileoverview twin-view 的渲染壳：把配置归一成 TwinConfig、把数组绑定按文档序
 * 缝回场景，再交给 3D 宿主。
 * ⚠ three 只能异步进：静态 import 会把整个 three 焊进任何引用本模块的入口静态图，
 * 不开孪生的大屏也要为它付首屏包体（DASHBOARD_DESIGN §5.4）。
 */
import type { InteractionEvent, ModuleMeta } from '@dt/contracts'
import type { TwinModalView } from '@dt/twin-config'
import {
  TWIN_ANCHOR_BINDING_KEY,
  TWIN_ARROW_BINDING_KEY,
  TWIN_CONFIG_KEY,
  TWIN_FLOW_BINDING_KEY,
  TWIN_HIER_BINDING_KEY,
  TWIN_PANEL_BINDING_KEY,
  flattenHierFields,
  flattenPanelFields,
  normalizeTwinConfig,
  stitchAnchorValues,
  stitchArrowValues,
  stitchFlowValues,
  stitchHierValues,
  stitchPanelValues,
} from '@dt/twin-config'
import { DtNotice } from '@dt/ui'
import { computed, defineAsyncComponent, ref, type CSSProperties } from 'vue'

import {
  readBoolean,
  readEnum,
  readNumber,
  readText,
} from '../../shared/config'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

const emit = defineEmits<{ interaction: [InteractionEvent] }>()

/** 当前钻进到哪一层；空串 = 钻取面板没开。 */
const drillNodeId = ref('')

/**
 * 点中部件时上抛联动事件，`value` 是**部件 id**；这个部件挂了钻取节点就顺便钻过去。
 * ⚠ 不上抛部件名：名字随时可改，而联动规则里存的那份不会跟着改，
 * 改完名字规则就静默失配——只表现为「点了没反应」。
 * ⚠ 联动事件照发不误：钻取是附加动作，不是替代——否则给部件配上钻取会把
 * 同屏别的模块的联动静默掐掉。
 */
function onPartClick(part: { partId: string }): void {
  emit('interaction', { event: 'click', value: part.partId })
  const target = scene.value.parts.find((item) => item.id === part.partId)
  const wanted = target?.clickHierNode ?? ''
  if (wanted === '') return
  // 指到一个已删掉的层就什么都不做；这种悬空由 collectTwinConfigIssues 报出来
  if (scene.value.hierNodes.some((item) => item.id === wanted)) {
    drillNodeId.value = wanted
  }
}

const CORNERS = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const

// 四角的偏移量与 3D 画布的边距同一套：12px 压上下、16px 压左右
const CORNER_OFFSETS: Record<(typeof CORNERS)[number], CSSProperties> = {
  'top-left': { top: '12px', left: '16px' },
  'top-right': { top: '12px', right: '16px' },
  'bottom-left': { bottom: '12px', left: '16px' },
  'bottom-right': { bottom: '12px', right: '16px' },
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

const TwinScene = defineAsyncComponent(async () => {
  const core = await import('@dt/three-core')
  return core.TwinScene
})

// ⚠ 与 3D 宿主走同一次异步 import：钻取面板自己不碰 three，但静态引进来会把
// 整个 three-core 桶焊进首屏静态图（DASHBOARD_DESIGN §5.4）
const TwinHierDrill = defineAsyncComponent(async () => {
  const core = await import('@dt/three-core')
  return core.TwinHierDrill
})

// ⚠ TwinScene 按引用比对这份配置，所以只能是 normalizeTwinConfig 的输出本身：
// 就地改字段不会重绘，而 computed 只在 config 换了对象时才产出新引用
const scene = computed(() => normalizeTwinConfig(props.config[TWIN_CONFIG_KEY]))
const title = computed(() => readText(props.config.title))
const showSceneTools = computed(() => readBoolean(props.config.showSceneTools))

const anchorValues = computed(() =>
  stitchAnchorValues(
    scene.value.anchors,
    props.values[TWIN_ANCHOR_BINDING_KEY],
  ),
)
const arrowValues = computed(() =>
  stitchArrowValues(scene.value.arrows, props.values[TWIN_ARROW_BINDING_KEY]),
)
// ⚠ 必须喂扁平化后的字段序：按「第 i 张牌」对齐会让多字段的牌之后整体错位
const panelValues = computed(() =>
  stitchPanelValues(
    flattenPanelFields(scene.value.panels),
    props.values[TWIN_PANEL_BINDING_KEY],
  ),
)
// ⚠ 必须喂扁平化后的字段序：按「第 i 个节点」对齐会让多字段的节点之后整体错位
const hierValues = computed(() =>
  stitchHierValues(
    flattenHierFields(scene.value.hierNodes),
    props.values[TWIN_HIER_BINDING_KEY],
  ),
)

/**
 * 钻进这一层时的取景：自己的快照优先，没有就退回它引用的预设视点。
 * ⚠ 两个都配了时预设视点静默不生效——编辑器上已把这一条摆明。
 */
const drillView = computed<TwinModalView | null>(() => {
  const node = scene.value.hierNodes.find(
    (item) => item.id === drillNodeId.value,
  )
  if (node === undefined) return null
  if (node.view !== null) return node.view
  const camera = scene.value.cameras.find((item) => item.id === node.cameraId)
  if (camera === undefined) return null
  return { position: camera.position, target: camera.target, fov: camera.fov }
})

const flowValues = computed(() =>
  stitchFlowValues(scene.value.flows, props.values[TWIN_FLOW_BINDING_KEY]),
)

const titleStyle = computed<CSSProperties>(() => ({
  ...CORNER_OFFSETS[readEnum(props.config.titlePosition, CORNERS, 'top-left')],
  fontSize: `${clamp(readNumber(props.config.titleFontSize, 16), 8, 72)}px`,
}))

// 取不到就说取不到：绝不留一块什么都不说的空画布（DASHBOARD_DESIGN §4.3）
const errorMessage = computed(() =>
  props.meta?.status === 'error'
    ? (props.meta.errorMessage ?? '孪生数据取不到')
    : '',
)
</script>

<template>
  <div class="dt-twin">
    <TwinScene
      :config="scene"
      :anchor-values="anchorValues"
      :arrow-values="arrowValues"
      :panel-values="panelValues"
      :flow-values="flowValues"
      :focus-view="drillView"
      :show-scene-tools="showSceneTools"
      :scene-title="title"
      @part-click="onPartClick"
    />
    <TwinHierDrill
      v-if="drillNodeId !== ''"
      class="dt-twin__drill"
      :nodes="scene.hierNodes"
      :node-id="drillNodeId"
      :values="hierValues"
      @update:node-id="drillNodeId = $event"
      @close="drillNodeId = ''"
    />
    <p v-if="title !== ''" class="dt-twin__title" :style="titleStyle">
      {{ title }}
    </p>
    <DtNotice v-if="errorMessage !== ''" class="dt-twin__error" intent="danger">
      {{ errorMessage }}
    </DtNotice>
  </div>
</template>

<style scoped lang="scss">
.dt-twin {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

// 四角定位与字号由内联样式给，其余观感跟主题走
.dt-twin__title {
  position: absolute;
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-display);
  letter-spacing: 0.06em;
  text-shadow: var(--fx-glow-title);
}

.dt-twin__drill {
  position: absolute;
  top: 12px;
  right: 16px;
  bottom: 12px;
  width: 280px;
  max-width: 45%;
}

.dt-twin__error {
  position: absolute;
  right: 16px;
  bottom: 12px;
  left: 16px;
}
</style>
