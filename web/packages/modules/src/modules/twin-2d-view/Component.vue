<script setup lang="ts">
/**
 * @fileoverview twin-2d-view 的渲染壳：读全部七个顶层配置键、把三个数组绑定槽缝回
 * 节点与连线、把状态那条数据线归一成节点渲染状态、逐槽交代取数四档（逐格上色 + 一枚
 * 整块汇总角标），再上抛联动。
 *
 * ⚠ 七个配置键**全在本文件里读**，三个槽键也在本文件里显式列一遍：`manifests.contract`
 * 判「死字段 / 暗键」的可达集只沿相对 import 走且必须落在 `packages/modules/src` 下，
 * 进不了 `@dt/twin2d`；而「绑定槽键两侧逐一对上」那条连可达集都不走，只扫模块目录。
 * 把消费点画在包里，这些键会被判成「声明了却没人读」而当场红
 * （docs/MODULE_TWIN_2D_DESIGN.md §3.2）。
 *
 * ⚠ 标注（`marks`）与节点、连线一样整份递给舞台：它按 `zOrder` 分成上下两层，形状由
 * 包里的 `Twin2dMarkShape` 画——编辑器挂的是同一份（§7.10 #74）。
 */
import type {
  InteractionEvent,
  ModuleMeta,
  ModuleSlotMeta,
} from '@dt/contracts'
import {
  TWIN_2D_BUILTIN_NODE_STYLES,
  TWIN_2D_CONFIG_KEY,
  TWIN_2D_DEFAULT_FIT_PADDING,
  TWIN_2D_DEFAULT_FLOW_SPEED,
  TWIN_2D_EDGE_BINDING_KEY,
  TWIN_2D_EDGE_PRESETS,
  TWIN_2D_FIT_MODES,
  TWIN_2D_MAX_FIT_PADDING,
  TWIN_2D_MAX_FLOW_SPEED,
  TWIN_2D_MIN_FIT_PADDING,
  TWIN_2D_MIN_FLOW_SPEED,
  TWIN_2D_NODE_BINDING_KEY,
  TWIN_2D_STATUS_BINDING_KEY,
  Twin2dStage,
  clamp,
  formatSlotValue,
  normalizeTwin2dConfig,
  twin2dBindingRows,
  twin2dValues,
  uniqueBy,
} from '@dt/twin2d'
import type {
  Twin2dEdgeState,
  Twin2dSlotFormat,
  Twin2dSlotRead,
  Twin2dSlotState,
  Twin2dStatus,
} from '@dt/twin2d'
import { computed } from 'vue'

import ModulePanel from '../../shared/ModulePanel.vue'
import {
  readBoolean,
  readEnum,
  readNumber,
  readText,
} from '../../shared/config'
import { toDeviceStatus } from '../../shared/status'
import { boolFromValue, reverseFromValue } from './edgeState'
import type { DeviceStatus } from '../../shared/status'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

const emit = defineEmits<{ interaction: [InteractionEvent] }>()

/**
 * 设备状态 → 节点渲染状态。
 * ⚠ `unknown` 映射成 `null` = **不覆盖**配置里的静态 status。取不到数据时把一个配成
 * `alarm` 的节点洗成灰的，与「把没有数据的设备显示成运行」是同一类谎（§10.1）。
 */
const STATUS_OVERLAY: Record<DeviceStatus, Twin2dStatus | null> = {
  running: 'online',
  standby: 'warning',
  alarm: 'alarm',
  offline: 'offline',
  unknown: null,
}

/** 连线标签读数的显示口径：连线没有槽位，精度与单位跟着读数本身走。 */
const EDGE_LABEL_FORMAT: Twin2dSlotFormat = {
  precision: null,
  unit: '',
  enumMap: {},
  placeholder: '',
  format: 'auto',
}

/** 节点 id 与槽键拼查表键时的分隔符；取一个 id 里出不来的控制字符。 */
const KEY_SEP = '\u0000'
/** 一条连线没绑「有流」子槽时按活跃画，与 `Twin2dEdgeState` 的缺省同档。 */
const EDGE_ACTIVE_FALLBACK = true
/** 多条取数失败的原因之间的分隔。 */
const REASON_SEP = '；'
/** 节点盒的根类；联动上抛时按它回溯被点中的节点。 */
const NODE_SELECTOR = '.t2-node'
/** 节点盒把自己的 id 挂在这个属性上。 */
const NODE_ID_ATTR = 'data-id'

/** 一格读数的取数档位与它的原因；`ok` 与「没有数据线」都落 `OK_GEAR`。 */
interface Twin2dSlotGear {
  state: Twin2dSlotState
  /** `error` 档的原因，画布上原样挂到那一格的 `title` 上；说不出原因给空串。 */
  reason: string
}

/** 有值那一档：一条样式都不改，读数照样式数据画。 */
const OK_GEAR: Twin2dSlotGear = { state: 'ok', reason: '' }
/** 未配来源那一档：这一行有 fieldKey，但运行时压根没下发它的结论。 */
const UNBOUND_GEAR: Twin2dSlotGear = { state: 'unbound', reason: '' }

/** 非 ok 的那两档在画布角上怎么交代。 */
interface Twin2dReadout {
  tone: 'pending' | 'error'
  /** 画在角上的一句话。 */
  text: string
  /** 原因那一项；说不出原因时一个属性都不产（空 `title` 会弹出一个空气泡）。 */
  attrs: Record<string, string>
}

const title = computed(() => readText(props.config.title))

// ⚠ 只能是 `normalizeTwin2dConfig` 的输出本身：行推导与缝合读值必须喂同一份归一化
// 结果，喂原始配置会因为脏条目被丢弃而让其后每一行整体错位一格（§14.2）
const scene = computed(() =>
  normalizeTwin2dConfig(props.config[TWIN_2D_CONFIG_KEY]),
)

// 关掉内置图标集：sprite 那一档整档不显示，自带图标集的项目用不着它
const showSprite = computed(() => readBoolean(props.config.showSprite, true))

/** 舞台与流动动画那四个键；包里一处都不读配置，全由这里读了递进去（§3.2）。 */
const stageView = computed(() => ({
  fitMode: readEnum(props.config.fitMode, TWIN_2D_FIT_MODES, 'contain'),
  fitPadding: clamp(
    readNumber(props.config.fitPadding, TWIN_2D_DEFAULT_FIT_PADDING),
    TWIN_2D_MIN_FIT_PADDING,
    TWIN_2D_MAX_FIT_PADDING,
  ),
  animateFlow: readBoolean(props.config.animateFlow),
  flowSpeed: clamp(
    readNumber(props.config.flowSpeed, TWIN_2D_DEFAULT_FLOW_SPEED),
    TWIN_2D_MIN_FLOW_SPEED,
    TWIN_2D_MAX_FLOW_SPEED,
  ),
}))

// 同 id 以文档里那一份为准，落不到才回预置库（§13.4）；`uniqueBy` 留最先出现的一条
const nodeStyles = computed(() =>
  uniqueBy(
    [...scene.value.styles, ...TWIN_2D_BUILTIN_NODE_STYLES],
    (style) => style.id,
  ),
)

const edgeStyles = computed(() =>
  uniqueBy(
    [...scene.value.edgeStyles, ...TWIN_2D_EDGE_PRESETS],
    (style) => style.id,
  ),
)

/**
 * 本模块消费的三个槽。
 * ⚠ 键在这里显式列一遍、不把整袋直接递下去：清单声明的槽键与渲染侧真正消费的槽键
 * 由契约测试逐一对上，而它只看得见本文件里的 `values[...]` 取法。少列一个键的表现是
 * 「那一路读数永远不来」，两边都不报错。
 */
const rows = computed(() => ({
  [TWIN_2D_NODE_BINDING_KEY]: props.values[TWIN_2D_NODE_BINDING_KEY],
  [TWIN_2D_STATUS_BINDING_KEY]: props.values[TWIN_2D_STATUS_BINDING_KEY],
  [TWIN_2D_EDGE_BINDING_KEY]: props.values[TWIN_2D_EDGE_BINDING_KEY],
}))

// 缝合只走 `twin2dValues` 这一处：编辑器那侧也用同一份，各写各的就会「核对过的
// 对应关系，到大屏上全接错对象」
const stitched = computed(() => twin2dValues(scene.value, rows.value))

const statusOverride = computed<Readonly<Record<string, Twin2dStatus | null>>>(
  () => {
    const out: Record<string, Twin2dStatus | null> = {}
    for (const [nodeId, raw] of Object.entries(stitched.value.status)) {
      out[nodeId] = STATUS_OVERLAY[toDeviceStatus(raw)]
    }
    return out
  },
)

/**
 * 连线标签的显示串；没绑上标签读数时给空串，让文档里配的静态标签接着显示。
 * ⚠ 绑上了却读不成数值时显示的是占位符而不是退回静态标签：一条坏掉的点位旁边挂着
 * 一个看起来正常的静态标签，比空着更容易被当成真读数。
 * @param raw 标签子槽的原值
 */
function edgeLabelText(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return ''
  return formatSlotValue(raw, EDGE_LABEL_FORMAT)
}

const edgeStates = computed<Readonly<Record<string, Twin2dEdgeState>>>(() => {
  const out: Record<string, Twin2dEdgeState> = {}
  for (const [edgeId, reading] of Object.entries(stitched.value.edges)) {
    out[edgeId] = {
      active: boolFromValue(reading.active, EDGE_ACTIVE_FALLBACK),
      reversed: reverseFromValue(reading.direction),
      label: edgeLabelText(reading.value),
    }
  }
  return out
})

/** 节点 id 加槽键 → 这一行落库的 fieldKey，逐槽取数结论按它查。 */
const slotFieldKeys = computed(() => {
  const keys = new Map<string, string>()
  for (const row of twin2dBindingRows(scene.value)) {
    if (row.slotKey !== TWIN_2D_NODE_BINDING_KEY) continue
    keys.set(`${row.entityId}${KEY_SEP}${row.entitySlot}`, row.fieldKey)
  }
  return keys
})

/**
 * 一格读数落在取数四档的哪一档。
 * ⚠ 整袋逐槽结论缺席时按**有值**算，不是按未配来源：设计态与独立挂载都没有数据线，
 * 判成未配来源的话编辑器预览里整张图会灰着，而运行态一切正常。
 * ⚠ 派生槽不进绑定行、因此没有 fieldKey，同样按有值算：它的值是就地算出来的，
 * 判成未配来源的话整条派生链在墙上永远是灰的占位符。
 * @param nodeId 节点 id
 * @param key 槽键
 */
function gearOf(nodeId: string, key: string): Twin2dSlotGear {
  const table = props.meta?.slots
  const field = slotFieldKeys.value.get(`${nodeId}${KEY_SEP}${key}`)
  if (table === undefined || field === undefined) return OK_GEAR
  const slot = table[field]
  if (slot === undefined) return UNBOUND_GEAR
  if (slot.state === 'ok') return OK_GEAR
  return { state: slot.state, reason: slot.message ?? '' }
}

/**
 * 一个槽位的口径、读数与档位。
 * ⚠ 档位跟着读数从**同一个函数**回去，包里据此逐格出色；分成两条 props 递下去的话，
 * 某一格的文字与它的颜色会来自不同的一帧。
 * ⚠ 非 ok 三档**不在这里**把值抹成 null：那一步归包里的 `resolveTxtContent`，
 * 它与出色读同一个 `state`。两处都抹就是两份口径，漂了只表现为「这一格的字与颜色对不上」。
 * @param nodeId 节点 id
 * @param key 槽键
 */
function readSlot(nodeId: string, key: string): Twin2dSlotRead | null {
  const read = stitched.value.readSlot(nodeId, key)
  return read === null ? null : { ...read, ...gearOf(nodeId, key) }
}

/**
 * 递给舞台的运行态。
 * ⚠ 两条素材解析**不在这里递**：图标要 `icons/` 前缀、画布底图要 `images/` 前缀，
 * 由应用壳启动期一次注入 `configureTwin2dAssets`，包里按 kind 各取各的。在这里
 * 递一条本地的，等于让其中一档拼错前缀，而拼错的表现只是那一档 404（§11.4）。
 */
const live = computed(() => ({
  status: statusOverride.value,
  slots: stitched.value.slots,
  readSlot,
  edges: edgeStates.value,
}))

/**
 * 取不到那一档的原因，去重后拼成一句。
 * @param failed 落在 error 档的那些槽
 */
function reasonsOf(failed: readonly ModuleSlotMeta[]): string {
  const messages = failed
    .map((slot) => slot.message ?? '')
    .filter((message) => message !== '')
  return [...new Set(messages)].join(REASON_SEP)
}

/**
 * 逐槽四档里非 ok 的那两档的**整块汇总**角标。
 * ⚠ 与逐格上色分工明确、不重复：画布上每一格自己的档位由 `readSlot` 递下去、
 * 由 `paintText` 逐格出色（哪一格坏了看得见）；这枚角标交代的是**整块有几格**非 ok
 * （一眼知道这块图值不值得信），它俩少了任何一个都留下一个说不清的洞（§9.6）。
 * ⚠ 本模块自报 `ownsStatusDisplay`，运行时因此**不给它盖整格状态浮层**——这两处不说，
 * 就没有第三处会说。
 * ⚠ 取不到压过等首帧：两档并存时先说要人管的那一档。
 */
const readout = computed<Twin2dReadout | null>(() => {
  const all = Object.values(props.meta?.slots ?? {})
  const failed = all.filter((slot) => slot.state === 'error')
  if (failed.length > 0) {
    const reason = reasonsOf(failed)
    return {
      tone: 'error',
      text: `${failed.length} 个读数取不到`,
      attrs: reason === '' ? {} : { title: reason },
    }
  }
  const waiting = all.filter((slot) => slot.state === 'pending').length
  if (waiting === 0) return null
  return { tone: 'pending', text: `${waiting} 个读数还没来`, attrs: {} }
})

/**
 * 点中节点时上抛 `{ event: 'select', value: 节点 id }`。
 * ⚠ **不上抛显示名**：名字随时会改，而联动规则里存的那份不会跟着改，改完只表现为
 * 「点了没反应」。
 * ⚠ 只在真配了联动规则时吞冒泡（`meta.interactive`）：两边都吞或都不吞，toggle 类
 * 动作会被整块兜底再捕获一次而当场自我抵消（§9.7）。
 * @param event 冒泡上来的那次点击
 */
function onCanvasClick(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof Element)) return
  const nodeId = target.closest(NODE_SELECTOR)?.getAttribute(NODE_ID_ATTR) ?? ''
  if (nodeId === '') return
  if (props.meta?.interactive === true) event.stopPropagation()
  emit('interaction', { event: 'select', value: nodeId })
}
</script>

<template>
  <ModulePanel :title="title">
    <div
      class="dt-twin2d"
      :class="{ 'dt-twin2d--no-sprite': !showSprite }"
      @click="onCanvasClick"
    >
      <Twin2dStage
        :canvas="scene.canvas"
        :nodes="scene.nodes"
        :edges="scene.edges"
        :marks="scene.marks"
        :node-styles="nodeStyles"
        :edge-styles="edgeStyles"
        :view="stageView"
        :live="live"
      />
      <p
        v-if="readout !== null"
        class="dt-twin2d__readout"
        :class="`dt-twin2d__readout--${readout.tone}`"
        v-bind="readout.attrs"
      >
        {{ readout.text }}
      </p>
    </div>
  </ModulePanel>
</template>

<style scoped lang="scss">
.dt-twin2d {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

// 关掉内置图标集时只摘 `use`，外壳留着占位：整枝抽掉会让同一张图在开关两侧跳版
.dt-twin2d--no-sprite :deep(use) {
  display: none;
}

.dt-twin2d__readout {
  position: absolute;
  right: 8px;
  bottom: 6px;
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
}

// ⚠ 这一档与「没配来源」在画布上是同一个占位符，透明度与呼吸是唯一的区分手段
.dt-twin2d__readout--pending {
  animation: dt-twin2d-breathe 1.6s ease-in-out infinite;
  color: var(--text-disabled);
  opacity: 0.45;
}

.dt-twin2d__readout--error {
  color: var(--state-danger);
}

@keyframes dt-twin2d-breathe {
  0%,
  100% {
    opacity: 0.45;
  }

  50% {
    opacity: 0.85;
  }
}

// 关掉的是 keyframes，不关 transition（§9.3）
@media (prefers-reduced-motion: reduce) {
  .dt-twin2d__readout--pending {
    animation: none;
  }
}
</style>
