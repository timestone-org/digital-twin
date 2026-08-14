<script setup lang="ts">
/**
 * @fileoverview NodeTree —— 一层节点的渲染：每个节点按设计像素绝对定位，
 * 容器节点把子层塞进自己的默认插槽再递归下去（docs/DASHBOARD_DESIGN.md §5.1）。
 * ⚠ 不可见节点根本**不挂载**（不是 `v-show`）：隐藏的模块要停止绑定求值、
 * 停掉 3D 与图表的副作用，藏起来继续跑等于白付一份算力。
 */
import type { CardChrome } from '@dt/contracts'
import { resolveContentInset } from '@dt/modules'
import { computed, inject, type CSSProperties } from 'vue'

import { INTERACTION_KEY } from './interactionRuntime'
import ModuleRenderer from './ModuleRenderer.vue'
import {
  containerGeometry,
  moduleRect,
  type DesignSize,
} from './dashboardGeometry'
import type { GetModuleManifest, RuntimeNode } from './nodeTree'

defineOptions({ name: 'NodeTree' })

const props = defineProps<{
  /** 本层节点，同一个父节点下的一批，已按 `(zIndex, id)` 定序。 */
  nodes: readonly RuntimeNode[]
  /** 本层坐标系尺寸：顶层是大屏设计尺寸，容器子层是父容器的内容区尺寸。 */
  design: DesignSize
  /** 注入式清单解析器，原样透传给每一格。 */
  getManifest: GetModuleManifest
  /** 大屏级卡片外观缺省，逐层原样透传；每格的模块级覆盖在自己的 config 里。 */
  cardChrome?: CardChrome | undefined
  /** 递归深度，顶层不传。 */
  depth?: number
  /**
   * 本层节点无条件渲染（节点弹窗的根用）：弹窗目标通常配成初始不可见，
   * 不掀开的话弹窗里就是一片空白。只作用于本层，子层照常按可见性走。
   */
  rootAlwaysVisible?: boolean
}>()

/** 递归层数上限：异常深的树停在这里，不把浏览器拖死。 */
const MAX_DEPTH = 24

const currentDepth = computed(() => props.depth ?? 0)

const canRecurse = computed(() => currentDepth.value < MAX_DEPTH)

// 联动运行时可选：没 provide（编辑器画布、独立渲染）就按持久显隐走
const interaction = inject(INTERACTION_KEY, null)

const visibleNodes = computed(() =>
  props.nodes.filter((node) => {
    if (props.rootAlwaysVisible === true) return true
    return interaction === null
      ? node.isVisible
      : interaction.isVisible(node.id)
  }),
)

const layerStyle = computed<CSSProperties>(() => ({
  width: `${props.design.width}px`,
  height: `${props.design.height}px`,
}))

/** 节点在本层里的绝对像素位置。 */
function styleOf(node: RuntimeNode): CSSProperties {
  const rect = moduleRect(node.box)
  return {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    zIndex: node.zIndex,
  }
}

/**
 * 子层坐标系 = 容器的内容区。
 * ⚠ 内缩由容器组件自己以 padding 让出来，这里只定子层边界；
 * 再把它加进子节点坐标就是加了两次，而加两次与漏加一样看不出是谁干的。
 */
function childDesignOf(node: RuntimeNode): DesignSize {
  return containerGeometry(
    moduleRect(node.box),
    resolveContentInset(node.config),
  )
}
</script>

<template>
  <div class="dt-node-layer" :style="layerStyle">
    <div
      v-for="node in visibleNodes"
      :key="node.id"
      class="dt-node"
      :style="styleOf(node)"
    >
      <ModuleRenderer
        :module-type="node.moduleType"
        :config="node.config"
        :bindings="node.bindings"
        :node-id="node.id"
        :get-manifest="getManifest"
        :card-chrome="cardChrome"
      >
        <NodeTree
          v-if="node.isContainer && canRecurse"
          :nodes="node.children"
          :design="childDesignOf(node)"
          :get-manifest="getManifest"
          :card-chrome="cardChrome"
          :depth="currentDepth + 1"
        />
      </ModuleRenderer>
    </div>
  </div>
</template>

<style scoped lang="scss">
// 本层的定位基准；溢出裁断，免得一格的溢出画到相邻模块上
.dt-node-layer {
  position: relative;
  overflow: hidden;
}

.dt-node {
  position: absolute;
}
</style>
