<script setup lang="ts">
/**
 * @fileoverview 样式检查器：一份节点样式的整体面——身份与来路、名字、调色板分栏、
 * 缺省尺寸与缺省状态、强调色，加端口、槽位、图元树与变体四张表。
 *
 * ⚠ 接的是 `styleFocus` 那条轴，与画布选中**并行**、互不清空：选着一个节点、同时
 *   编着它用的那份样式，本来就是常态。
 * ⚠ 收的是**当下生效**的那一份样式（文档里的优先，落不到才回预置库）：喂预置库
 *   那一份会把已有的覆盖整个抹掉，而界面上只表现为「刚才改的几项一起没了」。
 * ⚠ 内置样式改不了「就地」这回事——改一项等于在本图里落一份同 id 的覆盖（§13.4）。
 *   这句话要摆在面上：不说的话用户以为自己改的是预置库，而那份覆盖只在这张图里生效。
 * ⚠ 「恢复内置」= 删掉文档里那条覆盖，**不是**把预置数据写进文档：写死之后预置库
 *   将来升级就再也修不到这张图，而用户以为自己已经恢复了。
 * ⚠ 自己不碰文档：收「样式 + 整份配置」，产出整份新配置往上 emit；改配置一律走
 *   `styleOps`，在这里就地拼配置就是把「什么时候落一份覆盖」这条判断复制出第二份。
 * ⚠ 端口与槽位两张表逐键写回，一律走**合并撤销**、在控件 `blur` 时断段：每敲一个
 *   字母压一帧的话，撤销键按二十下才退得回一个词。
 * ⚠ 选中的那一枚图元是**外面**那条状态（`selectedPrim` + `pickPrim`）：图元字段面
 *   与画布高亮都要用它，收在这一层的话另外两处就拿不到。图元字段面与变体面各留一个
 *   具名插槽，由装配层塞进来。
 */
import { TWIN_2D_DEFAULT_STATUSES, TWIN_2D_OUTLINE_KINDS } from '@dt/twin2d'
import type {
  Twin2dConfig,
  Twin2dDefaultStatus,
  Twin2dNodeSize,
  Twin2dNodeStyle,
  Twin2dOutlineKind,
  Twin2dPort,
  Twin2dSlot,
} from '@dt/twin2d'
import {
  DtButton,
  DtEmpty,
  DtInput,
  DtNotice,
  DtNumberInput,
  DtSelect,
} from '@dt/ui'
import { computed } from 'vue'

import { enumOptions, fieldsChanged } from '../../scripts/inspectorFields'
import {
  restoreBuiltinNodeStyle,
  twin2dNodeStyleOrigin,
  twin2dNodeStyleUsage,
  updateNodeStyle,
} from '../../scripts/styleOps'
import ColorField from '../fields/ColorField.vue'
import PortList from '../fields/PortList.vue'
import SlotList from '../fields/SlotList.vue'
import PrimTree from './PrimTree.vue'

const props = withDefaults(
  defineProps<{
    /** 当下生效的那一份样式：文档里的优先，落不到才回预置库。 */
    nodeStyle: Twin2dNodeStyle
    /** 整份配置；改动整份产出往上 emit。 */
    config: Twin2dConfig
    /** 图元树上选中的那一枚；空串 = 一枚都没选。 */
    selectedPrim?: string
  }>(),
  { selectedPrim: '' },
)

const emit = defineEmits<{
  /** 一次性改动，落一帧撤销。 */
  change: [config: Twin2dConfig]
  /** 连续输入：同 `key` 的连着并成一帧。 */
  merge: [config: Twin2dConfig, key: string]
  /** 焦点离开输入框，这一段连续输入到此为止。 */
  endMerge: []
  /** 选中了图元树上的一枚；空串 = 取消选中。画布怎么高亮由装配层接。 */
  pickPrim: [primId: string]
  /** 图元树上按了复制；剪贴板归页面持有，本层只转发。 */
  copyPrim: []
  /** 图元树上按了粘贴；同上，与 ⌘V 是同一支。 */
  pastePrim: []
}>()

/** 缺省尺寸是画布上的整数像素，0 与负数画不出东西来。 */
const SIZE_RANGE = { min: 1, step: 1, precision: 0 }

const STATUS_LABELS: Readonly<Record<Twin2dDefaultStatus, string>> = {
  online: '在线',
  offline: '离线',
  warning: '告警',
  alarm: '报警',
  hidden: '不画状态点',
}

const STATUS_OPTIONS = TWIN_2D_DEFAULT_STATUSES.map((value) => ({
  value,
  label: STATUS_LABELS[value],
}))

// ⚠ 缺省值走 computed 不走 withDefaults 的读取端：exactOptionalPropertyTypes 下
// withDefaults 出来的仍是 `string | undefined`，往下传会在调用点报错
const selectedPrim = computed(() => props.selectedPrim ?? '')

const origin = computed(() =>
  twin2dNodeStyleOrigin(props.config, props.nodeStyle.id),
)

const usedBy = computed(
  () => twin2dNodeStyleUsage(props.config, props.nodeStyle.id).length,
)

/**
 * 每个端口 id 现在被多少条连线挂着。
 * ⚠ 只数挂在**用这份样式的节点**上的那些：一份样式二十个节点在用，按全图数会把别的
 * 样式的同名端口一起算进来，于是「改这个 id 安不安全」这句话就是错的。
 * ⚠ 表里的每个端口都要有一格（哪怕是 0）：0 与「不给」是两回事，前者才说得出
 * 「这个引脚还没接线，改 id 是安全的」。
 */
const portUsage = computed<Readonly<Record<string, number>>>(() => {
  const users = new Set(twin2dNodeStyleUsage(props.config, props.nodeStyle.id))
  const counts = new Map(props.nodeStyle.ports.map((port) => [port.id, 0]))
  for (const edge of props.config.edges) {
    for (const end of [edge.from, edge.to]) {
      const seen = counts.get(end.portId)
      if (seen !== undefined && users.has(end.nodeId)) {
        counts.set(end.portId, seen + 1)
      }
    }
  }
  return Object.fromEntries(counts)
})

/**
 * 把补丁落到整份配置上。
 * @param patch 要覆盖的字段
 */
function patched(patch: Partial<Omit<Twin2dNodeStyle, 'id'>>): Twin2dConfig {
  return updateNodeStyle(props.config, props.nodeStyle, patch)
}

/**
 * 这份补丁里至少有一个字段与现值不同。
 * ⚠ 数字框每次失焦都回抛一次当前值，不比一遍的话「点进去又点出来」就白记一帧撤销。
 * @param patch 要覆盖的字段
 */
function changed(patch: Partial<Omit<Twin2dNodeStyle, 'id'>>): boolean {
  return fieldsChanged({ ...props.nodeStyle }, { ...patch })
}

/**
 * 连续输入的一帧；同一段里连着敲并成一帧撤销。
 * ⚠ 合并段的标识带上样式 id：不带的话，改完 A 的名字接着改 B 的，两笔会并进同一帧，
 * 撤销一次把两份样式一起退回去。
 * @param patch 要覆盖的字段
 * @param field 这一格的名字，参与合并键
 */
function mergeOut(
  patch: Partial<Omit<Twin2dNodeStyle, 'id'>>,
  field: string,
): void {
  emit('merge', patched(patch), `style:${props.nodeStyle.id}:${field}`)
}

/**
 * 一次性改动。
 * @param patch 要覆盖的字段
 */
function write(patch: Partial<Omit<Twin2dNodeStyle, 'id'>>): void {
  if (changed(patch)) emit('change', patched(patch))
}

/**
 * 连续输入：与现值相同的那一手不记帧。
 * @param patch 要覆盖的字段
 * @param field 这一格的名字，参与合并键
 */
function writeMerged(
  patch: Partial<Omit<Twin2dNodeStyle, 'id'>>,
  field: string,
): void {
  if (changed(patch)) mergeOut(patch, field)
}

function endMerge(): void {
  emit('endMerge')
}

/**
 * 改缺省尺寸的一轴，另一轴原样带着。
 * ⚠ 尺寸是个对象，按引用比一定「变了」，所以这一支自己比两个数：不比的话，
 * 点进宽度框又点出来就白记一帧。
 * @param axis 动的是哪一轴
 * @param value 新值
 */
/** 外缘四档在面上叫什么。 */
const OUTLINE_LABELS: Readonly<Record<Twin2dOutlineKind, string>> = {
  rect: '矩形',
  round: '圆角矩形',
  ellipse: '椭圆',
  capsule: '胶囊',
}

const OUTLINE_OPTIONS = enumOptions(TWIN_2D_OUTLINE_KINDS, OUTLINE_LABELS)

/** 圆角取值域；上界由 `twin2dOutlinePoint` 按短边之半再夹一次，这里只挡负数。 */
const OUTLINE_R_RANGE = { min: 0, step: 1, precision: 0 }

/**
 * 换一档外缘；半径原样留着，换回圆角矩形时还是上次那个数。
 * @param next 下拉给回来的裸字符串
 */
function setOutlineKind(next: string): void {
  const found = TWIN_2D_OUTLINE_KINDS.find((item) => item === next)
  if (found === undefined || found === props.nodeStyle.outline.kind) return
  writeMerged(
    { outline: { ...props.nodeStyle.outline, kind: found } },
    'outline',
  )
}

/**
 * 改圆角半径。
 * @param next 新值
 */
function writeOutlineR(next: number): void {
  if (next === props.nodeStyle.outline.r) return
  writeMerged({ outline: { ...props.nodeStyle.outline, r: next } }, 'outline-r')
}

function writeSize(axis: 'w' | 'h', value: number): void {
  const current = props.nodeStyle.size
  const size: Twin2dNodeSize =
    axis === 'w' ? { ...current, w: value } : { ...current, h: value }
  if (size.w === current.w && size.h === current.h) return
  mergeOut({ size }, 'size')
}

/**
 * 换缺省状态；认不出的取值与当前这一档都不写回。
 * @param value 下拉给出的取值
 */
function setStatus(value: string): void {
  const found = TWIN_2D_DEFAULT_STATUSES.find((item) => item === value)
  if (found !== undefined) write({ defaultStatus: found })
}

/**
 * 恢复内置：删掉文档里那条同 id 的覆盖，让它落回预置库。
 * ⚠ 走 `styleOps` 的删覆盖，**不是**把预置数据写进文档（§13.4）。
 */
function restore(): void {
  const next = restoreBuiltinNodeStyle(props.config, props.nodeStyle.id)
  if (next !== props.config) emit('change', next)
}

/**
 * 端口表整份换。
 * @param ports 新的端口表
 */
function onPorts(ports: readonly Twin2dPort[]): void {
  mergeOut({ ports }, 'ports')
}

/**
 * 槽位表整份换。
 * ⚠ 槽位的文档序就是绑定行的行序（§14.2），动它一律交给页面那一个 `commit` 重派
 * 绑定，不在这里替它算。
 * ⚠ 这一张表**不喂** `usage`：数「一个槽键被几处引用」要走 `slotRefs` 那一份遍历，
 * 而它没从 `@dt/twin2d` 转出来。在这里手写一份的话，诊断面与这里迟早说两套话
 * （§14.2 点名那份口径全仓只许有一份），所以宁可退到 SlotList 的通用提示。
 * @param slots 新的槽位表
 */
function onSlots(slots: readonly Twin2dSlot[]): void {
  mergeOut({ slots }, 'slots')
}

/**
 * 图元树改出来的整份配置往上抛。
 * @param next 整份新配置
 */
function onPrims(next: Twin2dConfig): void {
  emit('change', next)
}

/**
 * 图元树上选中了一枚。
 * @param primId 那一枚的 id；空串 = 取消选中
 */
function onPickPrim(primId: string): void {
  emit('pickPrim', primId)
}
</script>

<template>
  <div
    class="flex flex-col gap-3"
    data-test="style-inspector"
    @focusout="endMerge"
  >
    <p class="text-2xs text-text-disabled" data-test="style-id">
      样式 {{ nodeStyle.id }} · {{ usedBy }} 个节点在用
    </p>

    <DtNotice
      v-if="origin === 'builtin'"
      intent="info"
      icon="alert-circle"
      data-test="style-builtin"
    >
      这是内置样式。在这里改任何一项，都会在本图里落一份同 id
      的覆盖，预置库本身不动。
    </DtNotice>

    <div
      v-else-if="origin === 'override'"
      class="flex flex-col gap-1.5"
      data-test="style-override"
    >
      <DtNotice intent="warning" icon="alert-triangle">
        本图里有一份覆盖压着同 id 的内置样式，改动只在这张图里生效。
      </DtNotice>
      <DtButton
        size="sm"
        variant="soft"
        intent="neutral"
        icon="refresh-cw"
        title="删掉本图里的这份覆盖，让它落回预置库那一份"
        data-test="style-restore"
        @click="restore"
      >
        恢复内置
      </DtButton>
    </div>

    <p v-else class="text-2xs text-text-disabled" data-test="style-custom">
      自建样式：预置库里没有同 id 的一份，删掉就没了。
    </p>

    <DtInput
      :model-value="nodeStyle.name"
      label="样式名"
      placeholder="板式换热器"
      size="sm"
      data-test="style-name"
      @update:model-value="writeMerged({ name: $event }, 'name')"
    />

    <DtInput
      :model-value="nodeStyle.category"
      label="调色板分栏"
      placeholder="exchanger"
      hint="只用于调色板分栏，一处渲染判断都不参与"
      size="sm"
      data-test="style-category"
      @update:model-value="writeMerged({ category: $event }, 'category')"
    />

    <div class="grid grid-cols-2 gap-1.5">
      <DtNumberInput
        :model-value="nodeStyle.size.w"
        :range="SIZE_RANGE"
        label="缺省宽"
        unit="px"
        hint="从调色板拖下来时的尺寸"
        size="sm"
        :steppers="false"
        data-test="style-w"
        @update:model-value="writeSize('w', $event ?? nodeStyle.size.w)"
      />
      <DtNumberInput
        :model-value="nodeStyle.size.h"
        :range="SIZE_RANGE"
        label="缺省高"
        unit="px"
        hint="节点自己的宽高为 0 时跟这里走"
        size="sm"
        :steppers="false"
        data-test="style-h"
        @update:model-value="writeSize('h', $event ?? nodeStyle.size.h)"
      />
    </div>

    <div class="grid grid-cols-2 gap-1.5">
      <DtSelect
        :model-value="nodeStyle.outline.kind"
        :options="OUTLINE_OPTIONS"
        label="外缘"
        hint="连线与端口接在这条线上，与图元怎么画无关"
        size="sm"
        data-test="style-outline"
        @update:model-value="setOutlineKind"
      />
      <DtNumberInput
        v-if="nodeStyle.outline.kind === 'round'"
        :model-value="nodeStyle.outline.r"
        :range="OUTLINE_R_RANGE"
        label="圆角"
        unit="px"
        hint="超过短边之半按短边之半算"
        size="sm"
        :steppers="false"
        data-test="style-outline-r"
        @update:model-value="writeOutlineR($event ?? nodeStyle.outline.r)"
      />
    </div>

    <DtSelect
      :model-value="nodeStyle.defaultStatus"
      :options="STATUS_OPTIONS"
      label="缺省状态"
      hint="节点自己的静态状态与实时状态行都会盖住它"
      size="sm"
      data-test="style-status"
      @update:model-value="setStatus"
    />

    <ColorField
      :model-value="nodeStyle.accent"
      fallback=""
      label="强调色"
      hint="留空 = 跟随主题；节点自己的强调色会盖住它"
      data-test="style-accent"
      @update:model-value="writeMerged({ accent: $event }, 'accent')"
      @blur="endMerge"
    />

    <section aria-label="端口" data-test="style-ports">
      <p class="mb-1 text-xs text-text-secondary">端口</p>
      <PortList
        :model-value="nodeStyle.ports"
        :usage="portUsage"
        @update:model-value="onPorts"
        @blur="endMerge"
      />
    </section>

    <section aria-label="槽位" data-test="style-slots">
      <p class="mb-1 text-xs text-text-secondary">槽位</p>
      <SlotList
        :model-value="nodeStyle.slots"
        @update:model-value="onSlots"
        @blur="endMerge"
      />
    </section>

    <section aria-label="图元树" data-test="style-prims">
      <p class="mb-1 text-xs text-text-secondary">图元树</p>
      <PrimTree
        :config="config"
        :node-style="nodeStyle"
        :selected="selectedPrim"
        @change="onPrims"
        @pick="onPickPrim"
        @copy="emit('copyPrim')"
        @paste="emit('pastePrim')"
      />
      <slot name="prim" />
    </section>

    <section aria-label="变体" data-test="style-variants">
      <p class="mb-1 text-xs text-text-secondary">
        变体 · {{ nodeStyle.variants.length }} 条
      </p>
      <slot name="variants">
        <DtEmpty
          size="inline"
          title="变体面板还没接上"
          hint="按文档序求值、后者覆盖前者。"
          data-test="style-variants-empty"
        />
      </slot>
    </section>
  </div>
</template>
