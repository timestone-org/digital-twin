<script setup lang="ts">
/**
 * @fileoverview 右栏检查器的分派：按当前选中把这一栏交给四个检查器之一，
 * 一个都没选中时落到画布检查器。
 *
 * ⚠ 这一层只分派，一处字段逻辑都不放：字段归各自的检查器，摊一半到这儿会让
 * 「这个字段在哪改」散成两处，而两处里总有一处会漏掉。
 * ⚠ 选中的那条实体可能已经不在了（撤销、重做与删除之后选中里会留下悬空 id，
 * 页面那道 `prune` 要等下一拍才摘）：找不到就落回画布那一段，而不是画一个空壳
 * ——空壳上改哪一项都写不回去且不报错。
 * ⚠ 样式那两类（`styles` / `edgeStyles`）不走这一栏：它们停在**另一条轴**上
 * （`styleFocus`），与画布选中并行，由样式面板自己画。
 */
import type {
  Twin2dConfig,
  Twin2dEdge,
  Twin2dMark,
  Twin2dNode,
} from '@dt/twin2d'
import { computed } from 'vue'

import type { Twin2dSelection } from '../scripts/types'
import CanvasInspector from './inspector/CanvasInspector.vue'
import EdgeInspector from './inspector/EdgeInspector.vue'
import MarkInspector from './inspector/MarkInspector.vue'
import NodeInspector from './inspector/NodeInspector.vue'

/** 这一栏当前该画谁。 */
type InspectorTarget =
  | { kind: 'canvas' }
  | { kind: 'node'; node: Twin2dNode }
  | { kind: 'edge'; edge: Twin2dEdge }
  | { kind: 'mark'; mark: Twin2dMark }

const props = defineProps<{
  /** 整份配置；检查器改完整份产出往上抛。 */
  config: Twin2dConfig
  /** 当前选中，来自 `editorSelection` 的 `inspect` 派生。 */
  selection: Twin2dSelection
}>()

const emit = defineEmits<{
  /** 一次性改动，落一帧撤销。 */
  change: [config: Twin2dConfig]
  /** 连续输入：同 `key` 的连着并成一帧。 */
  merge: [config: Twin2dConfig, key: string]
  /** 焦点离开输入框，这一段连续输入到此为止。 */
  endMerge: []
}>()

/** 没选中、选中了样式、或选中的那条实体已经不在了，都落到这一段。 */
const CANVAS_TARGET: InspectorTarget = { kind: 'canvas' }

/**
 * 选中 → 这一栏该画谁。
 * @param config 整份配置
 * @param at 当前选中
 */
function targetOf(config: Twin2dConfig, at: Twin2dSelection): InspectorTarget {
  switch (at.kind) {
    case 'nodes': {
      const node = config.nodes.find((row) => row.id === at.id)
      return node === undefined ? CANVAS_TARGET : { kind: 'node', node }
    }
    case 'edges': {
      const edge = config.edges.find((row) => row.id === at.id)
      return edge === undefined ? CANVAS_TARGET : { kind: 'edge', edge }
    }
    case 'marks': {
      const mark = config.marks.find((row) => row.id === at.id)
      return mark === undefined ? CANVAS_TARGET : { kind: 'mark', mark }
    }
    default:
      return CANVAS_TARGET
  }
}

const target = computed<InspectorTarget>(() =>
  targetOf(props.config, props.selection),
)

// ⚠ 收窄一律在 script 里做，不靠模板里的 `v-if`：模板收窄失手时 typecheck 与
// lint 双双放行，只在运行期读到 undefined
const node = computed<Twin2dNode | null>(() =>
  target.value.kind === 'node' ? target.value.node : null,
)
const edge = computed<Twin2dEdge | null>(() =>
  target.value.kind === 'edge' ? target.value.edge : null,
)
const mark = computed<Twin2dMark | null>(() =>
  target.value.kind === 'mark' ? target.value.mark : null,
)

/**
 * 一次性改动往上抛。
 * @param next 整份新配置
 */
function onChange(next: Twin2dConfig): void {
  emit('change', next)
}

/**
 * 连续输入的一帧往上抛。
 * @param next 整份新配置
 * @param key 这一段连续输入的标识
 */
function onMerge(next: Twin2dConfig, key: string): void {
  emit('merge', next, key)
}

function onEndMerge(): void {
  emit('endMerge')
}
</script>

<template>
  <div :data-kind="target.kind" data-test="twin2d-inspector">
    <NodeInspector
      v-if="node !== null"
      :node="node"
      :config="config"
      @change="onChange"
      @merge="onMerge"
      @end-merge="onEndMerge"
    />
    <EdgeInspector
      v-else-if="edge !== null"
      :edge="edge"
      :config="config"
      @change="onChange"
      @merge="onMerge"
      @end-merge="onEndMerge"
    />
    <MarkInspector
      v-else-if="mark !== null"
      :mark="mark"
      :config="config"
      @change="onChange"
      @merge="onMerge"
      @end-merge="onEndMerge"
    />
    <CanvasInspector
      v-else
      :config="config"
      @change="onChange"
      @merge="onMerge"
      @end-merge="onEndMerge"
    />
  </div>
</template>
