<script setup lang="ts">
/**
 * @fileoverview twin-view 的渲染壳：把配置归一成 TwinConfig、把数组绑定按文档序
 * 缝回场景，再交给 3D 宿主。
 * ⚠ three 只能异步进：静态 import 会把整个 three 焊进任何引用本模块的入口静态图，
 * 不开孪生的大屏也要为它付首屏包体（DASHBOARD_DESIGN §5.4）。
 */
import type { InteractionEvent, ModuleMeta } from '@dt/contracts'
import {
  TWIN_ANCHOR_BINDING_KEY,
  TWIN_ARROW_BINDING_KEY,
  TWIN_CONFIG_KEY,
  TWIN_FLOW_BINDING_KEY,
  TWIN_PANEL_BINDING_KEY,
  flattenPanelFields,
  normalizeTwinConfig,
  stitchAnchorValues,
  stitchArrowValues,
  stitchFlowValues,
  stitchPanelValues,
} from '@dt/twin-config'
import { DtNotice } from '@dt/ui'
import { computed, defineAsyncComponent, type CSSProperties } from 'vue'

import { readEnum, readNumber, readText } from '../../shared/config'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

const emit = defineEmits<{ interaction: [InteractionEvent] }>()

/**
 * 点中部件时上抛联动事件，`value` 是**部件 id**。
 * ⚠ 不上抛部件名：名字随时可改，而联动规则里存的那份不会跟着改，
 * 改完名字规则就静默失配——只表现为「点了没反应」。
 */
function onPartClick(part: { partId: string }): void {
  emit('interaction', { event: 'click', value: part.partId })
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

// ⚠ TwinScene 按引用比对这份配置，所以只能是 normalizeTwinConfig 的输出本身：
// 就地改字段不会重绘，而 computed 只在 config 换了对象时才产出新引用
const scene = computed(() => normalizeTwinConfig(props.config[TWIN_CONFIG_KEY]))
const title = computed(() => readText(props.config.title))

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
      @part-click="onPartClick"
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

.dt-twin__error {
  position: absolute;
  right: 16px;
  bottom: 12px;
  left: 16px;
}
</style>
