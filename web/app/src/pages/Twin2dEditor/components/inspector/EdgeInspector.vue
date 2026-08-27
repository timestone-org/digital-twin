<script setup lang="ts">
/**
 * @fileoverview 连线检查器：样式与走线、两端（节点 / 端口 / 沿边参数）、拐点表、
 * 标签与它在线上的落点，以及方向反转。
 *
 * ⚠ 自己不碰文档：只算出**新的整份配置**往上 emit——`change` 一步一帧，`merge` 同键
 *   并成一帧，`endMerge` 断段。文本框与滑块一律走 `merge`：每敲一个字母塞一帧进撤销
 *   栈，撤销键就等于废了。断段只有一处收口，即根节点上的 `focusout`。
 * ⚠ 端点解析优先级 `t` > `portId` > 朝向对方中心（§4.6）：钉了周长参数之后端口那
 *   一档就不生效了，面板上必须写出来——不写的表现是「改了端口没反应」且零报错。
 * ⚠ 拐点非空时压过走线档（`edgePath`）：加上第一个拐点之后四档走线全都不再生效。
 */
import type { DtSelectOption } from '@dt/contracts'
import {
  TWIN_2D_EDGE_PRESETS,
  TWIN_2D_EDGE_ROUTES,
  TWIN_2D_EDGE_ROW_SLOTS,
  edgeRowFieldKey,
  twin2dStyleResolver,
  uniqueBy,
} from '@dt/twin2d'
import type {
  Twin2dConfig,
  Twin2dEdge,
  Twin2dEdgeRoute,
  Twin2dEndpoint,
  Twin2dWaypoint,
} from '@dt/twin2d'
import {
  DtButton,
  DtInput,
  DtNumberInput,
  DtSelect,
  DtSlider,
  DtSwitch,
} from '@dt/ui'
import { computed } from 'vue'

import { updateEdge } from '../../scripts/edgeOps'
import {
  TWIN_2D_PX_RANGE,
  TWIN_2D_UNIT_RANGE,
} from '../../scripts/inspectorFields'
import { TWIN_2D_DEFAULT_SNAP } from '../../scripts/snapping'
import { insertWaypoint, removeWaypoint } from '../../scripts/waypointOps'
import ColorField from '../fields/ColorField.vue'

const props = defineProps<{ edge: Twin2dEdge; config: Twin2dConfig }>()

const emit = defineEmits<{
  /** 一步一帧的写入。 */
  change: [Twin2dConfig]
  /** 同键并成一帧的写入（逐键输入、拖滑块）。 */
  merge: [Twin2dConfig, string]
  /** 这一段连续输入结束了。 */
  endMerge: []
}>()

/** 两端在文档里的字段名。 */
type EndKey = 'from' | 'to'

/** 拐点的一根坐标。 */
type Axis = 'x' | 'y'

/** 一端要覆盖的字段。 */
type EndPatch = Partial<Twin2dEndpoint>

/** 一端摊平之后交给模板的那份。 */
interface EndView {
  key: EndKey
  title: string
  end: Twin2dEndpoint
  ports: readonly DtSelectOption[]
}

const ROUTE_LABELS: Readonly<Record<Twin2dEdgeRoute, string>> = {
  auto: '跟随样式',
  orthogonal: '正交折线',
  step: '阶梯折线',
  bezier: '贝塞尔曲线',
  straight: '直连',
}

const ROUTE_OPTIONS: readonly DtSelectOption[] = TWIN_2D_EDGE_ROUTES.map(
  (value) => ({ value, label: ROUTE_LABELS[value] }),
)

/** 端口那一档的「不钉」：由几何层朝对方中心自动选边。 */
const AUTO_PORT: DtSelectOption = { value: '', label: '自动（朝向对方中心）' }

const END_DEFS = [
  { key: 'from', title: '起点' },
  { key: 'to', title: '终点' },
] as const satisfies readonly { key: EndKey; title: string }[]

/** 第一次钉周长参数时给的那一档；精确落点靠画布上拖把手。 */
const FIRST_PERIM_T = 0.5

/**
 * 摆一个下拉项。⚠ 名字空着时退回 id：一行没有任何标识比显示 id 更糟。
 * @param id 落库取值
 * @param name 给人看的名字
 */
function optionOf(id: string, name: string): DtSelectOption {
  return { value: id, label: name.trim() === '' ? id : name.trim() }
}

/**
 * 当前取值不在名单里时把它原样补一档。
 * ⚠ 不补的表现是下拉显示成空白，而随手点开再点别处就把这个取值抹了——用户没打算改
 * 任何东西，配置却变了。
 * @param options 名单
 * @param current 当前取值
 */
function withCurrent(
  options: readonly DtSelectOption[],
  current: string,
): readonly DtSelectOption[] {
  if (current === '' || options.some((option) => option.value === current)) {
    return options
  }
  return [...options, { value: current, label: `失效：${current}` }]
}

/**
 * 写回整份配置。
 * @param patch 这条连线要覆盖的字段
 * @param slot 连续输入的格子名；给了就并成一帧撤销，不给即一步一帧
 */
function write(patch: Partial<Omit<Twin2dEdge, 'id'>>, slot?: string): void {
  const next = updateEdge(props.config, props.edge.id, patch)
  if (slot === undefined) emit('change', next)
  else emit('merge', next, `edge:${props.edge.id}:${slot}`)
}

/**
 * 改一端。
 * @param key 哪一端
 * @param patch 要覆盖的端点字段
 * @param slot 连续输入的格子名；不给即一步一帧
 */
function writeEnd(key: EndKey, patch: EndPatch, slot?: string): void {
  const end: Twin2dEndpoint = { ...props.edge[key], ...patch }
  write(key === 'from' ? { from: end } : { to: end }, slot)
}

/** 同 id 以文档里那一份为准，落不到才回预置库（§13.4）。 */
const styleOptions = computed<readonly DtSelectOption[]>(() =>
  withCurrent(
    uniqueBy(
      [...props.config.edgeStyles, ...TWIN_2D_EDGE_PRESETS],
      (style) => style.id,
    ).map((style) => optionOf(style.id, style.name)),
    props.edge.styleId,
  ),
)

const nodeOptions = computed<readonly DtSelectOption[]>(() =>
  props.config.nodes.map((node) => optionOf(node.id, node.label)),
)

/**
 * 一个节点上生效的端口摆成下拉项。
 * ⚠ 节点上的同 id 端口覆盖样式里的那一个，与 `portWorldPos` 的解析同序；反过来的
 * 表现是「改了引脚位置，画出来的点没动，线却挂到别处去了」。
 * @param nodeId 节点 id
 */
function portOptions(nodeId: string): readonly DtSelectOption[] {
  const node = props.config.nodes.find((item) => item.id === nodeId)
  if (node === undefined) return []
  const style = twin2dStyleResolver(props.config)(node.styleId)
  if (style === null) return []
  return uniqueBy([...node.ports, ...style.ports], (port) => port.id).map(
    (port) => optionOf(port.id, port.name),
  )
}

const ends = computed<readonly EndView[]>(() =>
  END_DEFS.map((def) => {
    const end = props.edge[def.key]
    return {
      key: def.key,
      title: def.title,
      end,
      ports: withCurrent([AUTO_PORT, ...portOptions(end.nodeId)], end.portId),
    }
  }),
)

/**
 * 换走线档；认不出的档位不写回。
 * ⚠ 下拉交出来的是裸串，不在这里判一下就只能靠断言把它按成联合类型——断言按下去的
 * 是编译期，写进文档的仍是那个认不出的档，而它会被归一化悄悄改成 `auto`。
 * @param value 下拉选中的档位
 */
function pickRoute(value: string): void {
  const route = TWIN_2D_EDGE_ROUTES.find((item) => item === value)
  if (route !== undefined) write({ route })
}

/** 拐点非空时四档走线全都不生效，得说出来。 */
const routeHint = computed(() =>
  props.edge.waypoints.length === 0
    ? '拐点为空时才按这一档'
    : '有拐点，走线档不生效',
)

/**
 * 这条线三个子槽的落库 fieldKey，行号就是它的文档序（§14.2）。
 * ⚠ 只摆 fieldKey 不抄子槽的中文名：名字在模块清单里，抄一份到这儿就会漂，
 *   而漂了的表现是面板指着错的子槽让人去绑。
 * ⚠ 活跃态与流向没有对应的文档字段——它们只由绑定决定，这里只能给去处。
 */
const bindingHint = computed(() => {
  const order = props.config.edges.findIndex((row) => row.id === props.edge.id)
  if (order < 0) return ''
  const keys = TWIN_2D_EDGE_ROW_SLOTS.map((slot) =>
    edgeRowFieldKey(order, slot),
  )
  return keys.join(' · ')
})

/**
 * 换一端挂的节点。
 * ⚠ 端口与周长参数都是**旧节点内部**的地址，跟着换过去只会指到不存在的引脚：几何层
 * 静默退回「朝向对方中心」，下拉里却还显示着那个引脚。
 * @param key 哪一端
 * @param nodeId 新节点
 */
function pickNode(key: EndKey, nodeId: string): void {
  writeEnd(key, { nodeId, portId: '', t: null })
}

/**
 * 钉不钉周长参数。
 * @param key 哪一端
 * @param on 钉住
 */
function pinPerim(key: EndKey, on: boolean): void {
  writeEnd(key, { t: on ? FIRST_PERIM_T : null })
}

/**
 * 反转方向：两端互换、拐点整体反序、`labelAt` 换成 `1 - labelAt`。
 * ⚠ 只换端点不反序拐点，带拐点的路径会自己交叉，看着像「拐点算错了」（§7 #66）；
 *   不换 `labelAt` 则线还在原地、标签跳到另一头去了，而用户没打算挪标签。
 */
function reverse(): void {
  write({
    from: props.edge.to,
    to: props.edge.from,
    waypoints: [...props.edge.waypoints].reverse(),
    labelAt: 1 - props.edge.labelAt,
  })
}

/** 新拐点落在最后一个拐点外一格；一个都没有时落在画布中心。 */
function newWaypointAt(): Twin2dWaypoint {
  const { canvas } = props.config
  const last = props.edge.waypoints.at(-1)
  if (last === undefined) return { x: canvas.width / 2, y: canvas.height / 2 }
  return { x: last.x + canvas.grid, y: last.y + canvas.grid }
}

/** 追加一个拐点，落点先吸网格。⚠ 不给 0,0：线会被甩到画布左上角。 */
function addWaypoint(): void {
  const snap = { ...TWIN_2D_DEFAULT_SNAP, grid: props.config.canvas.grid }
  write({
    waypoints: insertWaypoint(
      props.edge.waypoints,
      props.edge.waypoints.length,
      newWaypointAt(),
      snap,
    ),
  })
}

/**
 * 删掉一个拐点。
 * @param order 第几个
 */
function dropWaypoint(order: number): void {
  write({ waypoints: removeWaypoint(props.edge.waypoints, order) })
}

/**
 * 改一个拐点的一根坐标；同一格的逐键输入并成一帧撤销。
 * @param order 第几个拐点
 * @param axis 哪一根坐标
 * @param value 新坐标；清空当 0
 */
function writeWaypoint(
  order: number,
  axis: Axis,
  value: number | undefined,
): void {
  const at = value ?? 0
  const waypoints = props.edge.waypoints.map((point, seat) =>
    seat === order
      ? { ...point, ...(axis === 'x' ? { x: at } : { y: at }) }
      : point,
  )
  write({ waypoints }, `wp:${order}:${axis}`)
}
</script>

<template>
  <div class="flex flex-col gap-4" @focusout="emit('endMerge')">
    <section class="flex flex-col gap-2">
      <h3 class="text-xs font-medium text-text-secondary">外观</h3>
      <DtSelect
        :model-value="edge.styleId"
        :options="styleOptions"
        label="连线样式"
        size="sm"
        data-test="edge-style"
        @update:model-value="write({ styleId: $event })"
      />
      <DtSelect
        :model-value="edge.route"
        :options="ROUTE_OPTIONS"
        :hint="routeHint"
        label="走线"
        size="sm"
        data-test="edge-route"
        @update:model-value="pickRoute($event)"
      />
      <ColorField
        :model-value="edge.accent"
        label="主色"
        hint="留空 = 用样式的强调色"
        @update:model-value="write({ accent: $event }, 'accent')"
      />
    </section>

    <section class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-xs font-medium text-text-secondary">两端</h3>
        <DtButton
          size="xs"
          variant="soft"
          intent="neutral"
          icon="refresh-cw"
          data-test="edge-reverse"
          @click="reverse"
        >
          反转方向
        </DtButton>
      </div>

      <div
        v-for="item in ends"
        :key="item.key"
        class="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface-sunken p-2"
      >
        <span class="text-2xs text-text-secondary">{{ item.title }}</span>
        <DtSelect
          :model-value="item.end.nodeId"
          :options="nodeOptions"
          label="节点"
          size="sm"
          :data-test="`edge-node-${item.key}`"
          @update:model-value="pickNode(item.key, $event)"
        />
        <DtSelect
          :model-value="item.end.portId"
          :options="item.ports"
          label="端口"
          size="sm"
          :data-test="`edge-port-${item.key}`"
          @update:model-value="writeEnd(item.key, { portId: $event })"
        />
        <DtSwitch
          :model-value="item.end.t !== null"
          label="钉在周长参数上"
          size="sm"
          :data-test="`edge-pin-${item.key}`"
          @update:model-value="pinPerim(item.key, $event)"
        />
        <DtSlider
          v-if="item.end.t !== null"
          :model-value="item.end.t"
          :range="TWIN_2D_UNIT_RANGE"
          label="沿边参数 p"
          hint="绕节点一圈的 0..1；钉住之后端口那一档不再生效"
          size="sm"
          :data-test="`edge-t-${item.key}`"
          @update:model-value="
            writeEnd(item.key, { t: $event }, `t:${item.key}`)
          "
        />
      </div>
    </section>

    <section class="flex flex-col gap-1.5">
      <h3 class="text-xs font-medium text-text-secondary">
        拐点（{{ edge.waypoints.length }}）
      </h3>
      <p
        v-if="edge.waypoints.length === 0"
        class="text-xs text-text-disabled"
        data-test="edge-waypoints-empty"
      >
        没有拐点，这条线按走线档自动走。
      </p>
      <div
        v-for="(point, order) in edge.waypoints"
        :key="`wp-${order}`"
        class="flex items-end gap-1"
      >
        <DtNumberInput
          :model-value="point.x"
          :range="TWIN_2D_PX_RANGE"
          label="X"
          size="sm"
          :steppers="false"
          :data-test="`edge-wp-x-${order}`"
          @update:model-value="writeWaypoint(order, 'x', $event)"
        />
        <DtNumberInput
          :model-value="point.y"
          :range="TWIN_2D_PX_RANGE"
          label="Y"
          size="sm"
          :steppers="false"
          :data-test="`edge-wp-y-${order}`"
          @update:model-value="writeWaypoint(order, 'y', $event)"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="danger"
          icon="trash"
          aria-label="删除这个拐点"
          title="删除这个拐点"
          :data-test="`edge-wp-remove-${order}`"
          @click="dropWaypoint(order)"
        />
      </div>
      <DtButton
        size="sm"
        variant="soft"
        intent="neutral"
        icon="plus"
        block
        data-test="edge-wp-add"
        @click="addWaypoint"
      >
        新增拐点
      </DtButton>
    </section>

    <section class="flex flex-col gap-2">
      <h3 class="text-xs font-medium text-text-secondary">标签</h3>
      <DtInput
        :model-value="edge.label"
        label="字面量"
        placeholder="留空 = 只显示绑定读数"
        size="sm"
        data-test="edge-label"
        @update:model-value="write({ label: $event }, 'label')"
      />
      <DtSlider
        :model-value="edge.labelAt"
        :range="TWIN_2D_UNIT_RANGE"
        label="沿线位置"
        hint="0..1 沿折线弧长，0.5 是中点"
        size="sm"
        data-test="edge-label-at"
        @update:model-value="write({ labelAt: $event }, 'labelAt')"
      />
      <p
        v-if="bindingHint !== ''"
        class="text-2xs text-text-disabled"
        data-test="edge-binding-hint"
      >
        活跃态 / 流向 / 标签读数在绑点面板上接这三行：{{ bindingHint }}
      </p>
    </section>
  </div>
</template>
