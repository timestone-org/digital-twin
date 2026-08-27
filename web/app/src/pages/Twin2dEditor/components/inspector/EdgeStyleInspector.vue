<script setup lang="ts">
/**
 * @fileoverview 连线样式检查器：身份与来路、名字与强调色、多遍描边、走线与拐角、
 * 两端标记、流动动画、非活跃画法，以及标签排版。
 *
 * ⚠ 收的是**当下生效**的那一份样式（文档里的优先，落不到才回预置库）：喂预置库那
 *   一份会把已有的覆盖整个抹掉，而界面上只表现为「刚才改的几项一起没了」（§13.4）。
 * ⚠ 改内置样式 = 在本图里落一份同 id 的覆盖；「恢复内置」= 删掉那份覆盖，**不是**
 *   把预置数据写进文档——写死之后预置库将来升级就再也修不到这张图。
 * ⚠ 自己不碰文档：一律走 `styleOps` 算出整份新配置再上抛，在这里就地拼配置就是把
 *   「什么时候落一份覆盖」这条判断复制出第二份。
 * ⚠ 逐键写回一律走**合并撤销**、在根节点 `focusout` 时断段：每敲一个字母压一帧的话，
 *   撤销键按二十下才退得回一个词。
 */
import {
  TWIN_2D_EDGE_ROUTES,
  normalizeBorder,
  normalizePad,
  normalizeRadius,
} from '@dt/twin2d'
import type {
  Twin2dConfig,
  Twin2dEdgeFlow,
  Twin2dEdgeInactive,
  Twin2dEdgeLabel,
  Twin2dEdgeLabelBox,
  Twin2dEdgeMarker,
  Twin2dEdgeRoute,
  Twin2dEdgeStyle,
  Twin2dStrokePass,
} from '@dt/twin2d'
import type { FontValue } from '@dt/contracts'
import {
  DtButton,
  DtCheckbox,
  DtInput,
  DtNotice,
  DtNumberInput,
  DtSelect,
} from '@dt/ui'
import { computed } from 'vue'

import {
  TWIN_2D_UNIT_RANGE,
  enumOptions,
  fieldsChanged,
  twin2dFontWith,
} from '../../scripts/inspectorFields'
import {
  restoreBuiltinEdgeStyle,
  twin2dEdgeStyleOrigin,
  twin2dEdgeStyleUsage,
  updateEdgeStyle,
} from '../../scripts/styleOps'
import ColorField from '../fields/ColorField.vue'
import EdgeMarkerField from '../fields/EdgeMarkerField.vue'
import StrokePassList from '../fields/StrokePassList.vue'

const props = defineProps<{
  /** 当下生效的那一份连线样式。 */
  edgeStyle: Twin2dEdgeStyle
  /** 整份配置；改动整份产出往上 emit。 */
  config: Twin2dConfig
}>()

const emit = defineEmits<{
  change: [config: Twin2dConfig]
  merge: [config: Twin2dConfig, key: string]
  endMerge: []
}>()

/** 拐角半径（设计像素）；0 = 直角。 */
const RADIUS_RANGE = { min: 0, step: 1 }

/** 一遍流动跑多久（毫秒）。 */
const DURATION_RANGE = { min: 100, step: 100 }

/** 标签字号（设计像素）。 */
const FONT_RANGE = { min: 4, step: 1 }

/** 虚线段之间的分隔：空白或逗号都收，与描边那一格同一条判据。 */
const DASH_SEP = /[\s,]+/

const ROUTE_LABELS: Readonly<Record<Twin2dEdgeRoute, string>> = {
  auto: '跟随几何层缺省',
  orthogonal: '正交折线',
  step: '阶梯折线',
  bezier: '贝塞尔曲线',
  straight: '直连',
}

const ROUTE_OPTIONS = enumOptions(TWIN_2D_EDGE_ROUTES, ROUTE_LABELS)

/**
 * 打开底板时给的那一份。
 * ⚠ 三段子结构一律由归一化补缺省，不在这里抄一份：抄的那份一旦与归一化不一致，
 * 底板会在「存一次再读回来」之后变样，而这一步零报错。
 */
const NEW_LABEL_BOX: Twin2dEdgeLabelBox = Object.freeze({
  fill: '',
  border: normalizeBorder(undefined),
  radius: normalizeRadius(undefined),
  pad: normalizePad(undefined),
})

const origin = computed(() =>
  twin2dEdgeStyleOrigin(props.config, props.edgeStyle.id),
)

const usedBy = computed(
  () => twin2dEdgeStyleUsage(props.config, props.edgeStyle.id).length,
)

/** 虚线节奏摆成一行文本。 */
const dashText = computed(() => props.edgeStyle.flow.dash.join(' '))

/**
 * 把补丁落到整份配置上。
 * @param patch 要覆盖的字段
 */
function patched(patch: Partial<Omit<Twin2dEdgeStyle, 'id'>>): Twin2dConfig {
  return updateEdgeStyle(props.config, props.edgeStyle, patch)
}

/**
 * 一次性改动；与现值相同的那一手不记帧。
 * @param patch 要覆盖的字段
 */
function write(patch: Partial<Omit<Twin2dEdgeStyle, 'id'>>): void {
  if (fieldsChanged({ ...props.edgeStyle }, { ...patch })) {
    emit('change', patched(patch))
  }
}

/**
 * 连续输入的一帧；合并键带上样式 id，不带的话改完 A 接着改 B 会并进同一帧。
 * @param patch 要覆盖的字段
 * @param field 这一格的名字，参与合并键
 */
function mergeOut(
  patch: Partial<Omit<Twin2dEdgeStyle, 'id'>>,
  field: string,
): void {
  emit('merge', patched(patch), `edge-style:${props.edgeStyle.id}:${field}`)
}

/**
 * 换走线档；认不出的取值不写回。
 * @param value 下拉给出的取值
 */
function setRoute(value: string): void {
  const found = TWIN_2D_EDGE_ROUTES.find((item) => item === value)
  if (found !== undefined) write({ route: found })
}

/**
 * 换一遍描边表。
 * @param strokes 新的描边表
 */
function onStrokes(strokes: readonly Twin2dStrokePass[]): void {
  mergeOut({ strokes }, 'strokes')
}

/**
 * 改流动动画的一格。
 * @param patch 要覆盖的字段
 */
function writeFlow(patch: Partial<Twin2dEdgeFlow>): void {
  mergeOut({ flow: { ...props.edgeStyle.flow, ...patch } }, 'flow')
}

/**
 * 改非活跃画法的一格。
 * @param patch 要覆盖的字段
 */
function writeInactive(patch: Partial<Twin2dEdgeInactive>): void {
  mergeOut({ inactive: { ...props.edgeStyle.inactive, ...patch } }, 'inactive')
}

/**
 * 改标签排版的一格。
 * @param patch 要覆盖的字段
 */
function writeLabel(patch: Partial<Twin2dEdgeLabel>): void {
  mergeOut({ label: { ...props.edgeStyle.label, ...patch } }, 'label')
}

/**
 * 改标签字体里的一个键；空值删键（缺席才是「跟随排版」）。
 * @param key 哪一个键
 * @param value 新值
 */
function writeFont<K extends keyof FontValue>(
  key: K,
  value: FontValue[K],
): void {
  writeLabel({ font: twin2dFontWith(props.edgeStyle.label.font, key, value) })
}

/**
 * 虚线节奏逐键解析：认不出的逐段丢弃，与 `normalizeStrokes` 同一条判据。
 * @param raw 框里的原文
 */
function setDash(raw: string): void {
  const dash = raw
    .trim()
    .split(DASH_SEP)
    .map((piece) => Number(piece))
    .filter((value) => Number.isFinite(value) && value > 0)
  writeFlow({ dash })
}

/**
 * 开关标签底板；关掉是 `box: null`（那一档整块不画）。
 * @param on 画不画底板
 */
function setLabelBox(on: boolean): void {
  writeLabel({ box: on ? NEW_LABEL_BOX : null })
}

/**
 * 换一端的标记。
 * @param which 起点还是终点
 * @param marker 整个新标记
 */
function setMarker(
  which: 'startMarker' | 'endMarker',
  marker: Twin2dEdgeMarker,
): void {
  write(
    which === 'startMarker' ? { startMarker: marker } : { endMarker: marker },
  )
}

/** 恢复内置：删掉文档里那条同 id 的覆盖，让它落回预置库。 */
function restore(): void {
  const next = restoreBuiltinEdgeStyle(props.config, props.edgeStyle.id)
  if (next !== props.config) emit('change', next)
}

function endMerge(): void {
  emit('endMerge')
}
</script>

<template>
  <div
    class="flex flex-col gap-3"
    data-test="edge-style-inspector"
    @focusout="endMerge"
  >
    <p class="text-2xs text-text-disabled" data-test="edge-style-id">
      连线样式 {{ edgeStyle.id }} · {{ usedBy }} 条线在用
    </p>

    <DtNotice
      v-if="origin === 'builtin'"
      intent="info"
      icon="alert-circle"
      data-test="edge-style-builtin"
    >
      这是预置样式。在这里改任何一项，都会在本图里落一份同 id
      的覆盖，预置库本身不动。
    </DtNotice>
    <DtButton
      v-else-if="origin === 'override'"
      size="sm"
      variant="soft"
      intent="neutral"
      icon="refresh-cw"
      title="删掉本图里的这份覆盖，让它落回预置库那一份"
      data-test="edge-style-restore"
      @click="restore"
    >
      恢复内置
    </DtButton>

    <DtInput
      :model-value="edgeStyle.name"
      label="样式名"
      placeholder="热水管"
      size="sm"
      data-test="edge-style-name"
      @update:model-value="mergeOut({ name: $event }, 'name')"
    />

    <ColorField
      :model-value="edgeStyle.accent"
      fallback=""
      label="强调色"
      hint="留空 = 跟随主题；连线自己的强调色会盖住它"
      data-test="edge-style-accent"
      @update:model-value="mergeOut({ accent: $event }, 'accent')"
      @blur="endMerge"
    />

    <div class="grid grid-cols-2 gap-1.5">
      <DtSelect
        :model-value="edgeStyle.route"
        :options="ROUTE_OPTIONS"
        label="走线"
        size="sm"
        data-test="edge-style-route"
        @update:model-value="setRoute"
      />
      <DtNumberInput
        :model-value="edgeStyle.cornerRadius"
        :range="RADIUS_RANGE"
        label="拐角半径"
        unit="px"
        size="sm"
        :steppers="false"
        data-test="edge-style-corner"
        @update:model-value="
          write({ cornerRadius: $event ?? edgeStyle.cornerRadius })
        "
      />
    </div>

    <section aria-label="描边" data-test="edge-style-strokes">
      <p class="mb-1 text-xs text-text-secondary">描边</p>
      <StrokePassList
        :model-value="edgeStyle.strokes"
        hint="宽底窄芯叠成双线，单遍大线宽就是母线。"
        @update:model-value="onStrokes"
        @blur="endMerge"
      />
    </section>

    <section
      class="grid grid-cols-2 gap-1.5"
      aria-label="端点标记"
      data-test="edge-style-markers"
    >
      <EdgeMarkerField
        :model-value="edgeStyle.startMarker"
        label="起点标记"
        @update:model-value="setMarker('startMarker', $event)"
        @blur="endMerge"
      />
      <EdgeMarkerField
        :model-value="edgeStyle.endMarker"
        label="终点标记"
        @update:model-value="setMarker('endMarker', $event)"
        @blur="endMerge"
      />
    </section>

    <section
      class="flex flex-col gap-1.5"
      aria-label="流动"
      data-test="edge-style-flow"
    >
      <DtCheckbox
        :model-value="edgeStyle.flow.enabled"
        label="画流动动画"
        size="sm"
        data-test="edge-style-flow-on"
        @update:model-value="writeFlow({ enabled: $event })"
      />
      <DtInput
        :model-value="dashText"
        label="虚线节奏"
        placeholder="6 6"
        hint="空白或逗号分隔；认不出的那一段直接丢掉"
        size="sm"
        data-test="edge-style-flow-dash"
        @update:model-value="setDash"
      />
      <DtNumberInput
        :model-value="edgeStyle.flow.durationMs"
        :range="DURATION_RANGE"
        label="一遍跑多久"
        unit="ms"
        size="sm"
        :steppers="false"
        data-test="edge-style-flow-ms"
        @update:model-value="
          writeFlow({ durationMs: $event ?? edgeStyle.flow.durationMs })
        "
      />
    </section>

    <section
      class="flex flex-col gap-1.5"
      aria-label="非活跃"
      data-test="edge-style-inactive"
    >
      <DtNumberInput
        :model-value="edgeStyle.inactive.opacity"
        :range="TWIN_2D_UNIT_RANGE"
        label="非活跃不透明度"
        size="sm"
        :steppers="false"
        data-test="edge-style-inactive-opacity"
        @update:model-value="
          writeInactive({ opacity: $event ?? edgeStyle.inactive.opacity })
        "
      />
      <DtCheckbox
        :model-value="edgeStyle.inactive.dashOff"
        label="非活跃时拉直成实线"
        size="sm"
        data-test="edge-style-inactive-dash"
        @update:model-value="writeInactive({ dashOff: $event })"
      />
      <ColorField
        :model-value="edgeStyle.inactive.color"
        fallback=""
        label="非活跃色"
        hint="留空 = 沿用边色"
        data-test="edge-style-inactive-color"
        @update:model-value="writeInactive({ color: $event })"
        @blur="endMerge"
      />
    </section>

    <section
      class="flex flex-col gap-1.5"
      aria-label="标签"
      data-test="edge-style-label"
    >
      <div class="grid grid-cols-2 gap-1.5">
        <DtNumberInput
          :model-value="edgeStyle.label.font.size"
          :range="FONT_RANGE"
          label="标签字号"
          unit="px"
          size="sm"
          :steppers="false"
          data-test="edge-style-font-size"
          @update:model-value="writeFont('size', $event)"
        />
        <DtInput
          :model-value="edgeStyle.label.font.family ?? ''"
          label="标签字族"
          placeholder="跟随主题"
          size="sm"
          data-test="edge-style-font-family"
          @update:model-value="writeFont('family', $event)"
        />
      </div>
      <ColorField
        :model-value="edgeStyle.label.font.color ?? ''"
        fallback=""
        label="标签色"
        data-test="edge-style-font-color"
        @update:model-value="writeFont('color', $event)"
        @blur="endMerge"
      />
      <DtCheckbox
        :model-value="edgeStyle.label.box !== null"
        label="给标签画底板"
        size="sm"
        data-test="edge-style-label-box"
        @update:model-value="setLabelBox($event)"
      />
    </section>
  </div>
</template>
