<script setup lang="ts">
/**
 * @fileoverview 信息牌检查器：锚定 / 偏移 / 朝向 / 旋转 / 外观 / 字段 / 显隐。
 *
 * ⚠ `anchorId` 与 `position` 二选一，**前者优先**：两个都给时按锚点走，
 * `position` 那份静默不生效。用户配了没反应会找不到原因，所以面板上必须摆明。
 * ⚠ 旋转只在「钉死朝向」档有意义：另两档朝向每帧被相机接管，所以那两档下
 * 不摆旋转控件——摆一个改了没反应的输入框比没有更糟。
 */
import type { GizmoMode } from '@dt/three-core'
import {
  TWIN_BILLBOARD_MODES,
  TWIN_PANEL_ORIENTS,
  TWIN_PANEL_VARIANTS,
  type TwinAnchor,
  type TwinBillboardMode,
  type TwinPanel,
  type TwinPanelOrient,
  type TwinPanelVariant,
} from '@dt/twin-config'
import {
  DtButton,
  DtField,
  DtInput,
  DtNotice,
  DtSegmented,
  DtSelect,
} from '@dt/ui'
import { computed } from 'vue'

import InspectorSection from '../fields/InspectorSection.vue'
import PanelStyleFields from './PanelStyleFields.vue'
import PanelFieldList from '../fields/PanelFieldList.vue'
import type { TwinFrameView } from '../../scripts/coordFrame'
import PositionField from '../fields/PositionField.vue'
import Vec3Field from '../fields/Vec3Field.vue'
import VisibilityFields from '../fields/VisibilityFields.vue'

const props = defineProps<{
  modelValue: TwinPanel
  anchors: readonly TwinAnchor[]
  /** 坐标基准：这几个坐标框显示的是它下面的读数。 */
  frame: TwinFrameView
  /** 视口正在等用户点一个位置。 */
  picking: boolean
  /** 视口里坐标轴手柄当前的模式。 */
  gizmoMode: GizmoMode
}>()

const emit = defineEmits<{
  'update:modelValue': [TwinPanel]
  requestPickPosition: []
  cancelPick: []
  'update:gizmoMode': [GizmoMode]
}>()

const GIZMO_OPTIONS = [
  { value: 'translate', label: '拖位置' },
  { value: 'rotate', label: '拖旋转' },
] as const

/** 分段控件给回来的是裸字符串，对不上就当没改。 */
function writeGizmoMode(next: string): void {
  const found = GIZMO_OPTIONS.find((item) => item.value === next)
  if (found !== undefined) emit('update:gizmoMode', found.value)
}

const VARIANT_LABELS: Readonly<Record<TwinPanelVariant, string>> = {
  card: '卡片',
  hud: '战术 HUD',
  glass: '玻璃',
  bracket: '角标',
  tag: '标牌',
  precision: '精密切角',
  forge: '熔铸导轨',
  matrix: '信号矩阵',
}
const ORIENT_LABELS: Readonly<Record<TwinPanelOrient, string>> = {
  center: '居中（不画引线）',
  top: '上方',
  bottom: '下方',
  left: '左侧',
  right: '右侧',
}

/** 关掉自适应时给的初始宽度。 */
const FIXED_WIDTH = 240

const variantOptions = TWIN_PANEL_VARIANTS.map((value) => ({
  value,
  label: VARIANT_LABELS[value],
}))
const BILLBOARD_LABELS: Readonly<Record<TwinBillboardMode, string>> = {
  face: '始终朝相机',
  horizontal: '只水平跟随',
  fixed: '钉死朝向',
}
const billboardOptions = TWIN_BILLBOARD_MODES.map((value) => ({
  value,
  label: BILLBOARD_LABELS[value],
}))
const orientOptions = TWIN_PANEL_ORIENTS.map((value) => ({
  value,
  label: ORIENT_LABELS[value],
}))

const anchorOptions = computed(() => [
  { value: '', label: '（不锚定，用世界坐标）' },
  ...props.anchors.map((anchor, index) => ({
    value: anchor.id,
    label: anchor.name.trim() === '' ? `锚点 ${index + 1}` : anchor.name,
  })),
])

const anchored = computed(() => props.modelValue.anchorId !== '')

/** 锚定到一个已经不存在的锚点：那张牌会落在原点，不会报错。 */
const danglingAnchor = computed(
  () =>
    anchored.value &&
    !props.anchors.some((anchor) => anchor.id === props.modelValue.anchorId),
)

function write(patch: Partial<TwinPanel>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

/** 分段控件给回来的是裸字符串，对不上就当没改。 */
function writeBillboard(next: string): void {
  const found = TWIN_BILLBOARD_MODES.find((item) => item === next)
  if (found !== undefined) write({ billboard: found })
}

function togglePick(): void {
  if (props.picking) emit('cancelPick')
  else emit('requestPickPosition')
}
</script>

<template>
  <div class="flex flex-col">
    <InspectorSection title="基本">
      <DtField label="标题文本" hint="留空 = 不画标题行" size="sm">
        <DtInput
          :model-value="modelValue.name"
          aria-label="标题文本"
          size="sm"
          @update:model-value="write({ name: $event })"
        />
      </DtField>

      <DtField label="副标题" hint="标题上那行小字，会转成大写等宽" size="sm">
        <DtInput
          :model-value="modelValue.subtitle"
          aria-label="副标题"
          placeholder="如 COOLING LOOP / SECTOR 04"
          size="sm"
          @update:model-value="write({ subtitle: $event })"
        />
      </DtField>

      <DtField label="页脚文案" hint="留空 = 不画底栏" size="sm">
        <DtInput
          :model-value="modelValue.footnote"
          aria-label="页脚文案"
          placeholder="如 OPC-UA / NODE-042"
          size="sm"
          @update:model-value="write({ footnote: $event })"
        />
      </DtField>

      <DtField label="锚定" size="sm">
        <DtSelect
          :model-value="modelValue.anchorId"
          :options="anchorOptions"
          aria-label="锚定"
          size="sm"
          @update:model-value="write({ anchorId: $event })"
        />
      </DtField>

      <DtNotice v-if="anchored" intent="warning" icon="alert-triangle">
        已锚定：牌的位置以锚点为准，下面的坐标不生效。要用坐标定位，先把锚定改回「不锚定」。
      </DtNotice>
      <DtNotice v-if="danglingAnchor" intent="danger" icon="alert-circle">
        锚点 {{ modelValue.anchorId }} 不存在，这张牌会落在原点。
      </DtNotice>

      <DtField :label="anchored ? '坐标（当前不生效）' : '坐标'" size="sm">
        <PositionField
          :model-value="modelValue.position"
          :frame="frame"
          @update:model-value="write({ position: $event })"
        />
      </DtField>
      <template v-if="!anchored">
        <DtButton
          variant="soft"
          size="sm"
          :icon="picking ? 'close' : 'magnet'"
          block
          @click="togglePick"
        >
          {{ picking ? '取消拾取' : '从视口拾取位置' }}
        </DtButton>
        <p v-if="picking" class="text-xs text-text-secondary">
          在模型表面点一下，牌的中心会吸附到那个点。
        </p>
      </template>

      <DtField label="偏移" hint="相对锚点或上面那个坐标" size="sm">
        <Vec3Field
          :model-value="modelValue.offset"
          @update:model-value="write({ offset: $event })"
        />
      </DtField>

      <DtField
        label="朝向"
        hint="只水平跟随 = 牌永远竖着，俯视时不会躺下去"
        size="sm"
      >
        <DtSegmented
          :model-value="modelValue.billboard"
          :options="billboardOptions"
          aria-label="朝向"
          size="sm"
          block
          @update:model-value="writeBillboard"
        />
      </DtField>

      <template v-if="modelValue.billboard === 'fixed'">
        <!-- 轴标带度数记号：与上面坐标 / 偏移的 X/Y/Z 区分开，读屏与测试都不撞名 -->
        <DtField label="旋转" hint="绕 X / Y / Z 轴的欧拉角，度" size="sm">
          <Vec3Field
            :model-value="modelValue.rotation"
            :step="1"
            :axes="['X°', 'Y°', 'Z°']"
            @update:model-value="write({ rotation: $event })"
          />
        </DtField>
        <DtField
          v-if="!anchored"
          label="视口里怎么拖"
          hint="在 3D 里直接拖坐标轴手柄"
          size="sm"
        >
          <DtSegmented
            :model-value="gizmoMode"
            :options="GIZMO_OPTIONS"
            aria-label="视口里怎么拖"
            size="sm"
            block
            @update:model-value="writeGizmoMode"
          />
        </DtField>
      </template>
    </InspectorSection>

    <PanelStyleFields
      :model-value="modelValue.style"
      :variant-options="variantOptions"
      :orient-options="orientOptions"
      :fixed-width="FIXED_WIDTH"
      @update:model-value="write({ style: $event })"
    />

    <InspectorSection title="字段">
      <PanelFieldList
        :panel="modelValue"
        @update:fields="write({ fields: $event })"
      />
    </InspectorSection>

    <InspectorSection title="显隐">
      <VisibilityFields
        :model-value="modelValue.visibility"
        @update:model-value="write({ visibility: $event })"
      />
    </InspectorSection>
  </div>
</template>
