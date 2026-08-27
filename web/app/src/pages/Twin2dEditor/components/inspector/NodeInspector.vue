<script setup lang="ts">
/**
 * @fileoverview 节点检查器：一个节点实例的身份、样式、位姿、外观、标签、引脚、
 * 传感器与节点级图元覆盖。
 *
 * ⚠ 自己不碰文档：收「当前选中的节点 + 整份配置」，产出「新的整份配置」往上 emit，
 *   由页面那一个 `commit` 落。绕开它写的那一笔不会重派绑定，而界面上一切照旧。
 * ⚠ 文本类输入走**合并撤销**：`merge` 逐键并成一帧，失焦时 `endMerge` 断段。
 *   每敲一个字母压一帧的话，撤销键就废了——按二十下才退得回一个词。
 * ⚠ 合并段的标识带上节点 id：不带的话，改完 A 的显示名接着改 B 的，两笔会并进同一帧，
 *   撤销一次把两个节点一起退回去。
 * ⚠ 换档下拉与档位键都先比一遍现值：重选当前那一档不该在撤销栈上留一格按了没反应的
 *   空步。
 */
import type { DtSelectOption } from '@dt/contracts'
import {
  TWIN_2D_BUILTIN_NODE_STYLES,
  TWIN_2D_LABEL_POSITIONS,
  TWIN_2D_NODE_ROTATIONS,
  TWIN_2D_STATUSES,
  twin2dStyleResolver,
  uniqueBy,
} from '@dt/twin2d'
import type {
  Twin2dConfig,
  Twin2dLabelPos,
  Twin2dNode,
  Twin2dNodeRotation,
  Twin2dNodeStyle,
  Twin2dPort,
  Twin2dPrim,
  Twin2dPrimPatch,
  Twin2dSlot,
  Twin2dStatus,
} from '@dt/twin2d'
import {
  DtButton,
  DtCheckbox,
  DtInput,
  DtNotice,
  DtNumberInput,
  DtSelect,
} from '@dt/ui'
import { computed } from 'vue'

import { TWIN_2D_PX_RANGE } from '../../scripts/inspectorFields'
import { updateNode } from '../../scripts/nodeOps'
import ColorField from '../fields/ColorField.vue'
import NodeBadgeFields from './NodeBadgeFields.vue'
import NodeLayerList from './NodeLayerList.vue'
import NodePortList from './NodePortList.vue'
import NodeSensorList from './NodeSensorList.vue'
import NodeTagList from './NodeTagList.vue'

const props = defineProps<{
  /** 当前选中的节点。 */
  node: Twin2dNode
  /** 整份配置；改动整份产出往上 emit。 */
  config: Twin2dConfig
}>()

const emit = defineEmits<{
  /** 一次性改动，落一帧撤销。 */
  change: [config: Twin2dConfig]
  /** 连续输入：同 `key` 的连着并成一帧。 */
  merge: [config: Twin2dConfig, key: string]
  /** 焦点离开输入框，这一段连续输入到此为止。 */
  endMerge: []
}>()

/**
 * 分组标题那一行的 value 前缀。
 * ⚠ 取一个 id 里出不来的控制字符：撞上真样式 id 的话，两行同 key，那个样式就再也
 * 选不中了。
 */
const GROUP_PREFIX = '\u0000group:'

/** 宽高的 0 是「跟样式的 size 走」的哨兵值，所以不许为负。 */
const SIZE_RANGE = { min: 0, step: 1 }

/** 样式悬空时交出去的空表；不每次现造，免得下游的 computed 白重算。 */
const NO_PORTS: readonly Twin2dPort[] = Object.freeze([])
const NO_PRIMS: readonly Twin2dPrim[] = Object.freeze([])

/** 预置库的分栏名。⚠ 只用于分组显示，一处渲染判断都不参与。 */
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  source: '热源',
  vessel: '容器',
  terminal: '末端',
  exchanger: '换热',
  label: '标注',
  circuit: '电路符号',
}

const LABEL_POS_LABELS: Readonly<Record<Twin2dLabelPos, string>> = {
  bottom: '下方',
  top: '上方',
  left: '左侧',
  right: '右侧',
  inside: '居中覆盖',
  hidden: '不显示',
}

const STATUS_LABELS: Readonly<Record<Twin2dStatus, string>> = {
  online: '在线',
  offline: '离线',
  warning: '告警',
  alarm: '报警',
}

const LABEL_POS_OPTIONS = TWIN_2D_LABEL_POSITIONS.map((value) => ({
  value,
  label: LABEL_POS_LABELS[value],
}))

/** 静态状态：四档之外多一个「交给样式的 defaultStatus」。 */
const STATUS_OPTIONS = [
  { value: '', label: '默认（按样式）' },
  ...TWIN_2D_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] })),
]

/**
 * 分栏的显示名；没登记的分栏原样显示，空分栏归「其他」。
 * @param category 样式上的分栏名
 */
function categoryLabel(category: string): string {
  if (category === '') return '其他'
  return CATEGORY_LABELS[category] ?? category
}

/** 可选样式：文档里的压住同 id 的预置样式（§13.4）。 */
const allStyles = computed<readonly Twin2dNodeStyle[]>(() =>
  uniqueBy(
    [...props.config.styles, ...TWIN_2D_BUILTIN_NODE_STYLES],
    (item) => item.id,
  ),
)

/** 按分栏分组的下拉项；组标题是一条禁用项，键盘与指针都选不中它。 */
const styleOptions = computed<readonly DtSelectOption[]>(() => {
  const groups = new Map<string, Twin2dNodeStyle[]>()
  for (const item of allStyles.value) {
    const kept = groups.get(item.category)
    if (kept === undefined) groups.set(item.category, [item])
    else kept.push(item)
  }
  const options: DtSelectOption[] = []
  for (const [category, items] of groups) {
    options.push({
      value: `${GROUP_PREFIX}${category}`,
      label: categoryLabel(category),
      disabled: true,
    })
    for (const item of items) {
      options.push({ value: item.id, label: item.name })
    }
  }
  return options
})

const nodeStyle = computed<Twin2dNodeStyle | null>(() =>
  twin2dStyleResolver(props.config)(props.node.styleId),
)

const stylePorts = computed<readonly Twin2dPort[]>(
  () => nodeStyle.value?.ports ?? NO_PORTS,
)

const stylePrims = computed<readonly Twin2dPrim[]>(
  () => nodeStyle.value?.prims ?? NO_PRIMS,
)

/**
 * 写一笔改动。
 * ⚠ 节点不在这份配置里就一个字都不写：那说明右栏画的是一个已经被删掉的东西。
 * @param patch 要覆盖的字段
 * @param mergeKey 连续输入的段标识；一次性改动给 null
 */
function write(
  patch: Partial<Omit<Twin2dNode, 'id'>>,
  mergeKey: string | null,
): void {
  const next = updateNode(props.config, props.node.id, patch)
  if (next === props.config) return
  if (mergeKey === null) emit('change', next)
  else emit('merge', next, `node:${props.node.id}:${mergeKey}`)
}

function endMerge(): void {
  emit('endMerge')
}

/**
 * 换样式；认不出的取值（组标题就是其一）与当前这一个都不写回。
 * @param styleId 下拉给出的取值
 */
function setStyle(styleId: string): void {
  if (styleId === props.node.styleId) return
  if (!allStyles.value.some((item) => item.id === styleId)) return
  write({ styleId }, null)
}

/**
 * 换显示名位置；认不出的取值与当前这一档都不写回。
 * @param value 下拉给出的取值
 */
function setLabelPos(value: string): void {
  const labelPos = TWIN_2D_LABEL_POSITIONS.find((item) => item === value)
  if (labelPos === undefined || labelPos === props.node.labelPos) return
  write({ labelPos }, null)
}

/**
 * 换静态状态；认不出的取值一律当「默认（按样式）」。
 * @param value 下拉给出的取值
 */
function setStatus(value: string): void {
  const status: Twin2dStatus | '' =
    TWIN_2D_STATUSES.find((item) => item === value) ?? ''
  if (status === props.node.status) return
  write({ status }, null)
}

/**
 * 换旋转档位。
 * @param rotate 四档之一
 */
function setRotate(rotate: Twin2dNodeRotation): void {
  if (rotate === props.node.rotate) return
  write({ rotate }, null)
}

/**
 * 标签表整份换。
 * @param tags 新的标签表
 * @param mergeKey 连续输入的段标识
 */
function onTags(
  tags: Readonly<Record<string, string>>,
  mergeKey: string | null,
): void {
  write({ tags }, mergeKey)
}

/**
 * 引脚整份换。
 * @param ports 新的端口表
 * @param mergeKey 连续输入的段标识
 */
function onPorts(ports: readonly Twin2dPort[], mergeKey: string | null): void {
  write({ ports }, mergeKey)
}

/**
 * 传感器：追加图元与追加槽位一起换。
 * @param layers 新的追加图元
 * @param slots 新的追加槽位
 * @param mergeKey 连续输入的段标识
 */
function onSensors(
  layers: readonly Twin2dPrim[],
  slots: readonly Twin2dSlot[],
  mergeKey: string | null,
): void {
  write({ layers, slots }, mergeKey)
}

/**
 * 节点级图元：追加图元与覆盖补丁一起换。
 * @param layers 新的追加图元
 * @param patch 新的覆盖补丁
 * @param mergeKey 连续输入的段标识
 */
function onLayers(
  layers: readonly Twin2dPrim[],
  patch: Readonly<Record<string, Twin2dPrimPatch>>,
  mergeKey: string | null,
): void {
  write({ layers, patch }, mergeKey)
}
</script>

<template>
  <div
    class="flex flex-col gap-3"
    data-test="node-inspector"
    @focusout="endMerge"
  >
    <p class="text-2xs text-text-disabled" data-test="node-id">
      节点 {{ node.id }}
    </p>

    <DtNotice v-if="nodeStyle === null" intent="warning" icon="alert-triangle">
      这个节点引的样式 {{ node.styleId }} 不在册，图上不会画出它。
    </DtNotice>

    <DtSelect
      :model-value="node.styleId"
      :options="styleOptions"
      label="样式"
      size="sm"
      data-test="node-style"
      @update:model-value="setStyle"
    />

    <DtInput
      :model-value="node.label"
      label="显示名"
      size="sm"
      data-test="node-label"
      @update:model-value="write({ label: $event }, 'label')"
    />

    <DtSelect
      :model-value="node.labelPos"
      :options="LABEL_POS_OPTIONS"
      label="显示名位置"
      size="sm"
      data-test="node-label-pos"
      @update:model-value="setLabelPos"
    />

    <div class="grid grid-cols-2 gap-1.5">
      <DtNumberInput
        :model-value="node.x"
        :range="TWIN_2D_PX_RANGE"
        label="横坐标"
        unit="px"
        size="sm"
        :steppers="false"
        data-test="node-x"
        @update:model-value="write({ x: $event ?? 0 }, 'geometry')"
      />
      <DtNumberInput
        :model-value="node.y"
        :range="TWIN_2D_PX_RANGE"
        label="纵坐标"
        unit="px"
        size="sm"
        :steppers="false"
        data-test="node-y"
        @update:model-value="write({ y: $event ?? 0 }, 'geometry')"
      />
      <DtNumberInput
        :model-value="node.w"
        :range="SIZE_RANGE"
        label="宽"
        unit="px"
        hint="0 = 跟样式走"
        size="sm"
        :steppers="false"
        data-test="node-w"
        @update:model-value="write({ w: $event ?? 0 }, 'geometry')"
      />
      <DtNumberInput
        :model-value="node.h"
        :range="SIZE_RANGE"
        label="高"
        unit="px"
        hint="0 = 跟样式走"
        size="sm"
        :steppers="false"
        data-test="node-h"
        @update:model-value="write({ h: $event ?? 0 }, 'geometry')"
      />
    </div>

    <div class="grid grid-cols-4 gap-1" role="group" aria-label="旋转">
      <DtButton
        v-for="deg in TWIN_2D_NODE_ROTATIONS"
        :key="deg"
        size="sm"
        :pressed="node.rotate === deg"
        :data-test="`node-rotate-${deg}`"
        @click="setRotate(deg)"
      >
        {{ deg }}°
      </DtButton>
    </div>

    <div class="grid grid-cols-2 gap-1.5">
      <DtCheckbox
        :model-value="node.flipX"
        label="左右镜像"
        data-test="node-flip-x"
        @update:model-value="write({ flipX: $event }, null)"
      />
      <DtCheckbox
        :model-value="node.flipY"
        label="上下镜像"
        data-test="node-flip-y"
        @update:model-value="write({ flipY: $event }, null)"
      />
    </div>

    <DtSelect
      :model-value="node.status"
      :options="STATUS_OPTIONS"
      label="静态状态"
      hint="实时状态行会盖住它"
      size="sm"
      data-test="node-status"
      @update:model-value="setStatus"
    />

    <ColorField
      :model-value="node.accent"
      fallback=""
      label="强调色"
      hint="留空 = 用样式的强调色"
      @update:model-value="write({ accent: $event }, 'accent')"
      @blur="endMerge"
    />

    <NodeBadgeFields
      :badge="node.badge"
      :badge-color="node.badgeColor"
      :badge-shape="node.badgeShape"
      @update="write"
      @blur="endMerge"
    />

    <section aria-label="标签">
      <p class="mb-1 text-xs text-text-secondary">标签</p>
      <NodeTagList :model-value="node.tags" @update="onTags" @blur="endMerge" />
    </section>

    <section aria-label="传感器">
      <p class="mb-1 text-xs text-text-secondary">传感器</p>
      <NodeSensorList
        :layers="node.layers"
        :slots="node.slots"
        @update="onSensors"
        @blur="endMerge"
      />
    </section>

    <section aria-label="引脚">
      <p class="mb-1 text-xs text-text-secondary">引脚</p>
      <NodePortList
        :model-value="node.ports"
        :style-ports="stylePorts"
        @update="onPorts"
        @blur="endMerge"
      />
    </section>

    <section aria-label="图元覆盖">
      <p class="mb-1 text-xs text-text-secondary">图元覆盖</p>
      <NodeLayerList
        :layers="node.layers"
        :patch="node.patch"
        :style-prims="stylePrims"
        @update="onLayers"
        @blur="endMerge"
      />
    </section>
  </div>
</template>
