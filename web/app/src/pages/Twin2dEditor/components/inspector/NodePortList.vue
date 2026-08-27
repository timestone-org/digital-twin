<script setup lang="ts">
/**
 * @fileoverview 节点上的端口（引脚）：追加自己的，或按 id 覆盖样式里的那一个。
 *
 * ⚠ 同 id 就是覆盖，不是另加一个：`nodePortDots` 与 `portWorldPos` 都按「节点上的
 *   同 id 端口压住样式里那一个」解析。想挪样式里某个引脚，就把它「覆盖」进来再改；
 *   另起一个新 id 只会在旁边多出一个连不上线的点。
 * ⚠ 落点两档换来换去时取的是**归一化缺省**：在这里抄一份缺省，换档之后存一次再读
 *   回来就会悄悄变样。
 * ⚠ 引脚名逐键写回时不 trim：trim 了再回填 DOM，空格键就永远打不出来。
 * ⚠ 落点取值一律在 script 里解出来，不靠模板里的 `v-if` 收窄联合类型：模板收窄失手
 *   时 typecheck 与 lint 双双放行，只在运行期读到 undefined。
 */
import {
  TWIN_2D_PORT_AT_KINDS,
  TWIN_2D_PORT_DIRS,
  TWIN_2D_PORT_SIDES,
} from '@dt/twin2d'
import type {
  Twin2dPort,
  Twin2dPortAtKind,
  Twin2dPortDir,
  Twin2dPortSide,
} from '@dt/twin2d'
import {
  DtButton,
  DtCheckbox,
  DtEmpty,
  DtInput,
  DtNumberInput,
  DtSelect,
} from '@dt/ui'
import { computed } from 'vue'

import { freshTwin2dId } from '../../scripts/nodeOps'
import { TWIN_2D_UNIT_RANGE } from '../../scripts/inspectorFields'

const props = defineProps<{
  /** 节点上的端口：追加的，或覆盖样式里同 id 那一个的。 */
  modelValue: readonly Twin2dPort[]
  /** 这个节点用的样式里的端口，供「覆盖」入口列举。 */
  stylePorts: readonly Twin2dPort[]
}>()

const emit = defineEmits<{
  /** 换一份端口；`mergeKey` 非空表示这是一段连续输入里的一帧。 */
  update: [readonly Twin2dPort[], string | null]
  /** 一段连续输入到此为止。 */
  blur: []
}>()

/** 新引脚 id 的前缀。 */
const PORT_PREFIX = 'port'

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

/** 样式里还没被覆盖的那些引脚。 */
const overridable = computed(() =>
  props.stylePorts
    .filter((port) => !props.modelValue.some((own) => own.id === port.id))
    .map((port) => ({
      value: port.id,
      label: port.name === '' ? port.id : `${port.name} · ${port.id}`,
    })),
)

/**
 * 这一条压住的是样式里的同 id 引脚。
 * @param id 这一条的 id
 */
function isOverride(id: string): boolean {
  return props.stylePorts.some((port) => port.id === id)
}

/** 面板上的一行：一条端口，加上它落点那一档已经解出来的取值。 */
interface PortRow {
  port: Twin2dPort
  /** 沿周长那一档的位置；不是这一档时为 null。 */
  perim: number | null
  /** 盒内坐标那一档的位置；不是这一档时为 null。 */
  xy: { x: number; y: number } | null
}

const rows = computed<readonly PortRow[]>(() =>
  props.modelValue.map((port) => ({
    port,
    perim: port.at.kind === 'perim' ? port.at.t : null,
    xy: port.at.kind === 'xy' ? { x: port.at.x, y: port.at.y } : null,
  })),
)

/**
 * 改一条端口的若干字段。
 * @param id 这一条的 id
 * @param patch 要覆盖的字段
 * @param mergeKey 连续输入的段标识；一次性改动给 null
 */
function patchPort(
  id: string,
  patch: Partial<Omit<Twin2dPort, 'id'>>,
  mergeKey: string | null,
): void {
  emit(
    'update',
    props.modelValue.map((port) =>
      port.id === id ? { ...port, ...patch } : port,
    ),
    mergeKey,
  )
}

/**
 * 换连线方向；认不出的取值不写回。
 * @param id 这一条的 id
 * @param value 下拉给出的取值
 */
function setDir(id: string, value: string): void {
  const dir = TWIN_2D_PORT_DIRS.find((item) => item === value)
  if (dir !== undefined) patchPort(id, { dir }, null)
}

/**
 * 换出线朝向；认不出的取值不写回。
 * @param id 这一条的 id
 * @param value 下拉给出的取值
 */
function setSide(id: string, value: string): void {
  const side = TWIN_2D_PORT_SIDES.find((item) => item === value)
  if (side !== undefined) patchPort(id, { side }, null)
}

/**
 * 换落点档位；两档的缺省与 `normalizePortAt` 逐字相同。
 * @param id 这一条的 id
 * @param kind 落点档位
 */
function setAtKind(id: string, kind: string): void {
  if (kind === 'xy') patchPort(id, { at: { kind, ...XY_DEFAULT } }, null)
  else if (kind === 'perim') patchPort(id, { at: { kind, t: 0 } }, null)
}

/**
 * 挪周长那一档的落点。
 * @param id 这一条的 id
 * @param t 周长参数
 */
function setPerim(id: string, t: number): void {
  patchPort(id, { at: { kind: 'perim', t } }, `port-at:${id}`)
}

/**
 * 挪盒内坐标那一档的落点；另一轴原样带着。
 * ⚠ 现有取值由行算好后传进来，不在这里按 id 再查一次表：多出来的那条兜底分支
 *   界面上到不了，也就永远测不到。
 * @param id 这一条的 id
 * @param at 这一档现在落在哪
 * @param axis 动的是哪一轴
 * @param value 新值
 */
function setXy(
  id: string,
  at: { x: number; y: number },
  axis: 'x' | 'y',
  value: number,
): void {
  patchPort(
    id,
    {
      at: {
        kind: 'xy',
        x: axis === 'x' ? value : at.x,
        y: axis === 'y' ? value : at.y,
      },
    },
    `port-at:${id}`,
  )
}

/** 追加一个自己的引脚，落在周长起点、朝向待解析。 */
function addPort(): void {
  const id = freshTwin2dId(
    PORT_PREFIX,
    new Set(props.modelValue.map((port) => port.id)),
  )
  const port: Twin2dPort = {
    id,
    name: '',
    at: { kind: 'perim', t: 0 },
    dir: 'both',
    side: 'auto',
    showName: false,
    marker: null,
  }
  emit('update', [...props.modelValue, port], null)
}

/**
 * 把样式里的一个引脚抄进节点，之后改的就是这一份。
 * @param id 样式里那个引脚的 id
 */
function overridePort(id: string): void {
  const port = props.stylePorts.find((item) => item.id === id)
  if (port === undefined) return
  emit('update', [...props.modelValue, { ...port }], null)
}

/**
 * 删掉一条；覆盖那一条删掉之后落回样式里的原件。
 * @param id 这一条的 id
 */
function removePort(id: string): void {
  emit(
    'update',
    props.modelValue.filter((port) => port.id !== id),
    null,
  )
}
</script>

<template>
  <div class="flex flex-col gap-1.5" @focusout="emit('blur')">
    <DtEmpty
      v-if="modelValue.length === 0"
      size="inline"
      title="没有节点级引脚"
      hint="连线挂的是样式里那几个；要挪位置就把它覆盖进来。"
      data-test="port-empty"
    />

    <div
      v-for="row in rows"
      :key="row.port.id"
      class="flex flex-col gap-1.5 rounded border border-border-subtle bg-surface-sunken p-2"
      :data-test="`port-row-${row.port.id}`"
    >
      <div class="flex items-center gap-1">
        <span class="min-w-0 flex-1 truncate text-xs text-text-secondary">
          {{ row.port.id }}
          <template v-if="isOverride(row.port.id)">· 覆盖样式引脚</template>
        </span>
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
        size="sm"
        placeholder="1 / A / GND"
        :data-test="`port-name-${row.port.id}`"
        @update:model-value="
          patchPort(row.port.id, { name: $event }, `port-name:${row.port.id}`)
        "
      />

      <div class="grid grid-cols-2 gap-1.5">
        <DtSelect
          :model-value="row.port.dir"
          :options="DIR_OPTIONS"
          label="方向"
          size="sm"
          :data-test="`port-dir-${row.port.id}`"
          @update:model-value="setDir(row.port.id, $event)"
        />
        <DtSelect
          :model-value="row.port.side"
          :options="SIDE_OPTIONS"
          label="出线朝向"
          size="sm"
          :data-test="`port-side-${row.port.id}`"
          @update:model-value="setSide(row.port.id, $event)"
        />
      </div>

      <DtSelect
        :model-value="row.port.at.kind"
        :options="AT_OPTIONS"
        label="落点"
        size="sm"
        :data-test="`port-at-kind-${row.port.id}`"
        @update:model-value="setAtKind(row.port.id, $event)"
      />

      <DtNumberInput
        v-if="row.perim !== null"
        :model-value="row.perim"
        :range="TWIN_2D_UNIT_RANGE"
        label="周长位置"
        size="sm"
        :steppers="false"
        :data-test="`port-t-${row.port.id}`"
        @update:model-value="setPerim(row.port.id, $event ?? 0)"
      />

      <div v-if="row.xy !== null" class="grid grid-cols-2 gap-1.5">
        <DtNumberInput
          :model-value="row.xy.x"
          :range="TWIN_2D_UNIT_RANGE"
          label="横向"
          size="sm"
          :steppers="false"
          :data-test="`port-x-${row.port.id}`"
          @update:model-value="setXy(row.port.id, row.xy, 'x', $event ?? 0)"
        />
        <DtNumberInput
          :model-value="row.xy.y"
          :range="TWIN_2D_UNIT_RANGE"
          label="纵向"
          size="sm"
          :steppers="false"
          :data-test="`port-y-${row.port.id}`"
          @update:model-value="setXy(row.port.id, row.xy, 'y', $event ?? 0)"
        />
      </div>

      <DtCheckbox
        :model-value="row.port.showName"
        label="在图上显示引脚名"
        :data-test="`port-show-name-${row.port.id}`"
        @update:model-value="patchPort(row.port.id, { showName: $event }, null)"
      />
    </div>

    <DtSelect
      v-if="overridable.length > 0"
      model-value=""
      :options="overridable"
      :display="{ placeholder: '覆盖样式里的引脚…' }"
      size="sm"
      aria-label="覆盖样式里的引脚"
      data-test="port-override"
      @update:model-value="overridePort"
    />

    <DtButton
      size="sm"
      variant="soft"
      intent="neutral"
      icon="plus"
      block
      data-test="port-add"
      @click="addPort"
    >
      追加一个引脚
    </DtButton>
  </div>
</template>
