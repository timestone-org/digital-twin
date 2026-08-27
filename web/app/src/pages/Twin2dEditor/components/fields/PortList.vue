<script setup lang="ts">
/**
 * @fileoverview 端口（引脚）表的编辑面：落点两形、方向四档、出线朝向五档，外加引脚
 * 符号（几何 + 多遍描边 + 填充 + 伸出长度）。
 *
 * ⚠ `id` 是**寻址键**：连线两端挂的就是它，改 id 等于换一个引脚，挂在旧 id 上的线
 *   当场落空。所以 id 走草稿、失焦时才落，并把「现在有几条线挂着」摆在旁边。
 * ⚠ id 逐键写回还有第二层坏处：它同时是 `v-for` 的 key，每敲一个字这一行就整行重建
 *   一次，焦点当场丢掉——键盘上根本改不完一个 id。
 * ⚠ 同 id 只会留下最先那一条（`normalizePorts` 按 id 去重），所以改重名时不写回并
 *   当场说明；不说明的话另一个引脚会在存盘那一刻凭空消失。
 * ⚠ 引脚符号只给形状是不够的：线宽决定它与导线接不接得上，而线宽不对既不报错也不像
 *   bug，只像「画得难看」。一遍描边都不给时落盘会补一遍 2px 的缺省。
 * ⚠ 引脚符号的几何恒按 `unit` 画（`buildPinViews` 拿 `marker.length` 当盒边长），
 *   所以这里的几何控件不摆坐标口径那一档；渐变那一档同理禁掉——引脚没有局部渐变表。
 * ⚠ 落点两档换来换去取的是**归一化缺省**，与 `normalizePortAt` 逐字相同：抄一份不
 *   一致的，换档之后存一次再读回来就会悄悄变样。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import {
  TWIN_2D_PORT_AT_KINDS,
  TWIN_2D_PORT_DIRS,
  TWIN_2D_PORT_SIDES,
} from '@dt/twin2d'
import type {
  Twin2dPinMarker,
  Twin2dPort,
  Twin2dPortAtKind,
  Twin2dPortDir,
  Twin2dPortSide,
  Twin2dShape,
  Twin2dStrokePass,
} from '@dt/twin2d'
import {
  DtButton,
  DtCheckbox,
  DtEmpty,
  DtInput,
  DtNumberInput,
  DtSelect,
} from '@dt/ui'
import { computed, ref, watch } from 'vue'

import { TWIN_2D_UNIT_RANGE } from '../../scripts/inspectorFields'
import { freshTwin2dId } from '../../scripts/nodeOps'
import { useKeyDrafts } from '../../scripts/useKeyDrafts'
import PinMarkerField from './PinMarkerField.vue'

const props = defineProps<{
  modelValue: readonly Twin2dPort[]
  /**
   * 每个引脚 id 现在被多少条连线挂着；不给就只给一句通用提示。
   * ⚠ 空表与「不给」是两回事：前者说得出「这个引脚还没接线，改 id 是安全的」。
   */
  usage?: Readonly<Record<string, number>>
}>()

const emit = defineEmits<{
  'update:modelValue': [readonly Twin2dPort[]]
  blur: []
}>()

/** 新引脚 id 的前缀。 */
const PORT_PREFIX = 'port'

/** 与 `colorOr` 的兜底同一档。 */
const INHERITED_COLOR = 'currentColor'

/** 引脚短横线伸出多长，与 `normalizePinMarker` 的缺省逐字相同。 */
const PIN_LENGTH = 8

/** 换到盒内坐标那一档时的缺省，与 `normalizePortAt` 逐字相同。 */
const XY_DEFAULT = { x: 0.5, y: 0.5 }

const DIR_LABELS: Readonly<Record<Twin2dPortDir, string>> = {
  in: '入线',
  out: '出线',
  both: '双向',
  passive: '无向',
}

const SIDE_LABELS: Readonly<Record<Twin2dPortSide, string>> = {
  top: '朝上',
  right: '朝右',
  bottom: '朝下',
  left: '朝左',
  auto: '自动（按落点解析）',
}

const AT_LABELS: Readonly<Record<Twin2dPortAtKind, string>> = {
  perim: '沿周长',
  xy: '盒内坐标',
}

const DIR_OPTIONS = TWIN_2D_PORT_DIRS.map((value) => ({
  value,
  label: DIR_LABELS[value],
}))

const SIDE_OPTIONS = TWIN_2D_PORT_SIDES.map((value) => ({
  value,
  label: SIDE_LABELS[value],
}))

const AT_OPTIONS = TWIN_2D_PORT_AT_KINDS.map((value) => ({
  value,
  label: AT_LABELS[value],
}))

/** 面板上的一行：一条端口，加上落点与引脚符号里已经解出来的取值。 */
interface Twin2dPortRow {
  port: Twin2dPort
  /** 沿周长那一档的位置；不是这一档时为 null。 */
  perim: number | null
  /** 盒内坐标那一档的位置；不是这一档时为 null。 */
  xy: { x: number; y: number } | null
  marker: Twin2dPinMarker | null
}

/** 改名落不下去时的两句说明。 */
const ID_MESSAGES = {
  empty: '引脚 id 不能为空：没有 id 的引脚挂不上连线',
  taken: '这个 id 已经被另一个引脚占着，同 id 只会留下最先那一条',
}

/** 焦点还在本控件里；在里面时不拿文档里的值去盖用户正敲着的那半截。 */
const focused = ref(false)

const drafts = useKeyDrafts(
  () => props.modelValue.map((port) => port.id),
  ID_MESSAGES,
)

// ⚠ 落点那一档的联合类型在 script 里解开，不靠模板里的 v-if 收窄：模板收窄失手时
//   typecheck 与 lint 双双放行，只在运行期读到 undefined
const rows = computed<readonly Twin2dPortRow[]>(() =>
  props.modelValue.map((port) => ({
    port,
    perim: port.at.kind === 'perim' ? port.at.t : null,
    xy: port.at.kind === 'xy' ? { x: port.at.x, y: port.at.y } : null,
    marker: port.marker,
  })),
)

watch(
  () => props.modelValue,
  () => {
    if (!focused.value) drafts.reset()
  },
)

function onFocusIn(): void {
  focused.value = true
}

function onFocusOut(): void {
  focused.value = false
  emit('blur')
}

function write(next: readonly Twin2dPort[]): void {
  emit('update:modelValue', next)
}

/**
 * 改一条端口的若干字段。
 * @param id 这一条的 id
 * @param patch 要覆盖的字段
 */
function patchPort(id: string, patch: Partial<Omit<Twin2dPort, 'id'>>): void {
  write(
    props.modelValue.map((port) =>
      port.id === id ? { ...port, ...patch } : port,
    ),
  )
}

/**
 * 改 id 会影响什么。
 * @param id 这一条的 id
 */
function idHint(id: string): string {
  const count = props.usage?.[id]
  if (count === undefined) return '连线按 id 挂在引脚上，改 id 等于换一个引脚'
  if (count === 0) return '还没有连线挂在这个引脚上，改 id 是安全的'
  return `有 ${count} 条连线挂在这个引脚上，改 id 会让它们落空`
}

/**
 * 落定一次改名；改不动时草稿自己清掉、框拨回文档里的 id。
 * @param id 这一条现在的 id
 */
function commitId(id: string): void {
  const next = drafts.commit(id)
  if (next === null) return
  write(
    props.modelValue.map((port) =>
      port.id === id ? { ...port, id: next } : port,
    ),
  )
}

function writeDir(id: string, next: string): void {
  const dir = TWIN_2D_PORT_DIRS.find((item) => item === next)
  if (dir !== undefined) patchPort(id, { dir })
}

function writeSide(id: string, next: string): void {
  const side = TWIN_2D_PORT_SIDES.find((item) => item === next)
  if (side !== undefined) patchPort(id, { side })
}

function writeAtKind(id: string, next: string): void {
  if (next === 'xy') patchPort(id, { at: { kind: 'xy', ...XY_DEFAULT } })
  else if (next === 'perim') patchPort(id, { at: { kind: 'perim', t: 0 } })
}

/**
 * 挪盒内坐标那一档的落点；另一轴原样带着。
 * @param id 这一条的 id
 * @param at 这一档现在落在哪
 * @param axis 动的是哪一轴
 * @param value 新值
 */
function writeXy(
  id: string,
  at: { x: number; y: number },
  axis: 'x' | 'y',
  value: number,
): void {
  patchPort(id, {
    at: {
      kind: 'xy',
      x: axis === 'x' ? value : at.x,
      y: axis === 'y' ? value : at.y,
    },
  })
}

/** 一枚新引脚符号：一道 2px 的短横线，落地就看得见。 */
function newMarker(): Twin2dPinMarker {
  const stroke: Twin2dStrokePass = {
    id: 'stroke-0',
    width: 2,
    color: INHERITED_COLOR,
    dash: [],
    cap: 'butt',
    join: 'miter',
    opacity: 1,
    nonScaling: false,
  }
  const shape: Twin2dShape = { kind: 'line', x1: 0, y1: 0.5, x2: 1, y2: 0.5 }
  return {
    shape,
    strokes: [stroke],
    fill: { kind: 'none' },
    length: PIN_LENGTH,
  }
}

function toggleMarker(id: string, on: boolean): void {
  patchPort(id, { marker: on ? newMarker() : null })
}

function addPort(): void {
  const taken = new Set(props.modelValue.map((port) => port.id))
  write([
    ...props.modelValue,
    {
      id: freshTwin2dId(PORT_PREFIX, taken),
      name: '',
      at: { kind: 'perim', t: 0 },
      dir: 'both',
      side: 'auto',
      showName: false,
      marker: null,
    },
  ])
}

function removePort(id: string): void {
  write(props.modelValue.filter((port) => port.id !== id))
}
</script>

<template>
  <div
    class="flex flex-col gap-1.5"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <DtEmpty
      v-if="modelValue.length === 0"
      size="inline"
      title="还没有引脚"
      hint="连线要挂在引脚上；没有引脚时只能挂到节点中心。"
      data-test="port-empty"
    />

    <div
      v-for="row in rows"
      :key="row.port.id"
      class="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface-sunken p-2"
      :data-test="`port-row-${row.port.id}`"
    >
      <div class="flex items-end gap-1" @focusout="commitId(row.port.id)">
        <DtInput
          class="min-w-0 flex-1"
          :model-value="drafts.textOf(row.port.id)"
          label="引脚 id"
          size="sm"
          :hint="idHint(row.port.id)"
          :error="drafts.errorOf(row.port.id)"
          :data-test="`port-id-${row.port.id}`"
          @update:model-value="drafts.edit(row.port.id, $event)"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="danger"
          icon="trash"
          aria-label="删除这个引脚"
          title="删除这个引脚"
          :data-test="`port-remove-${row.port.id}`"
          @click="removePort(row.port.id)"
        />
      </div>

      <DtInput
        :model-value="row.port.name"
        label="引脚名"
        placeholder="1 / A / GND"
        size="sm"
        :data-test="`port-name-${row.port.id}`"
        @update:model-value="patchPort(row.port.id, { name: $event })"
      />

      <div class="grid grid-cols-2 gap-1.5">
        <DtSelect
          :model-value="row.port.dir"
          :options="DIR_OPTIONS"
          label="方向"
          size="sm"
          :data-test="`port-dir-${row.port.id}`"
          @update:model-value="writeDir(row.port.id, $event)"
        />
        <DtSelect
          :model-value="row.port.side"
          :options="SIDE_OPTIONS"
          label="出线朝向"
          size="sm"
          :data-test="`port-side-${row.port.id}`"
          @update:model-value="writeSide(row.port.id, $event)"
        />
      </div>

      <DtSelect
        :model-value="row.port.at.kind"
        :options="AT_OPTIONS"
        label="落点"
        size="sm"
        :data-test="`port-at-kind-${row.port.id}`"
        @update:model-value="writeAtKind(row.port.id, $event)"
      />

      <DtNumberInput
        v-if="row.perim !== null"
        :model-value="row.perim"
        :range="TWIN_2D_UNIT_RANGE"
        label="周长位置"
        size="sm"
        :steppers="false"
        :data-test="`port-t-${row.port.id}`"
        @update:model-value="
          patchPort(row.port.id, { at: { kind: 'perim', t: $event ?? 0 } })
        "
      />

      <div v-if="row.xy !== null" class="grid grid-cols-2 gap-1.5">
        <DtNumberInput
          :model-value="row.xy.x"
          :range="TWIN_2D_UNIT_RANGE"
          label="横向"
          size="sm"
          :steppers="false"
          :data-test="`port-x-${row.port.id}`"
          @update:model-value="writeXy(row.port.id, row.xy, 'x', $event ?? 0)"
        />
        <DtNumberInput
          :model-value="row.xy.y"
          :range="TWIN_2D_UNIT_RANGE"
          label="纵向"
          size="sm"
          :steppers="false"
          :data-test="`port-y-${row.port.id}`"
          @update:model-value="writeXy(row.port.id, row.xy, 'y', $event ?? 0)"
        />
      </div>

      <DtCheckbox
        :model-value="row.port.showName"
        label="在图上显示引脚名"
        :data-test="`port-show-name-${row.port.id}`"
        @update:model-value="patchPort(row.port.id, { showName: $event })"
      />

      <DtCheckbox
        :model-value="row.marker !== null"
        label="画引脚符号（短横线 / 小圆点）"
        :data-test="`port-marker-${row.port.id}`"
        @update:model-value="toggleMarker(row.port.id, $event)"
      />

      <PinMarkerField
        v-if="row.marker !== null"
        :model-value="row.marker"
        @update:model-value="patchPort(row.port.id, { marker: $event })"
        @blur="emit('blur')"
      />
    </div>

    <DtButton
      size="sm"
      variant="soft"
      intent="neutral"
      icon="plus"
      block
      data-test="port-add"
      @click="addPort"
    >
      新增一个引脚
    </DtButton>
  </div>
</template>
