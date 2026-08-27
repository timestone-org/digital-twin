<script setup lang="ts">
/**
 * @fileoverview 右栏「通用配置」页：每个模块都有的那几样——名字、几何、层序、
 * 初始可见，以及**模块级卡片外观**。
 * ⚠ 卡片外观这一段是两级里的下面一级：留空 = 不写键 = 继承画布的缺省，
 * 填了才盖过去。写死一份「当前看起来的样子」等于把此刻的画布缺省固化进这张大屏。
 */
import type {
  CardChrome,
  DashboardNodePayload,
  ModuleManifest,
} from '@dt/contracts'
import { mergeCardChrome } from '@dt/runtime'
import {
  DtButton,
  DtField,
  DtHelpTip,
  DtInput,
  DtNumberInput,
  DtSwitch,
} from '@dt/ui'
import { computed, ref, watch } from 'vue'

import type { ConfigPath } from '@/features/dashboard/configPath'
import { useCanvasCardDefault } from '@/features/dashboard/editorContext'
import type {
  LayerPosition,
  NodeGeometry,
} from '@/features/dashboard/editorDoc'
import { nodeLabelOf } from '@/features/dashboard/nodeLabel'
import {
  chromeEntries,
  type CardFieldContext,
} from '../scripts/cardStyleFields'
import type { OrderKind } from '../scripts/useEditorInspector'
import CardStyleFields from './CardStyleFields.vue'

const props = defineProps<{
  node: DashboardNodePayload
  manifest: ModuleManifest | undefined
  /** 在同层兄弟里排第几，用来标出层序并把到头的那一头置灰。 */
  layer: LayerPosition | null
}>()

const emit = defineEmits<{
  config: [path: ConfigPath, value: unknown, isContinuous: boolean]
  geometry: [geometry: NodeGeometry, isContinuous: boolean]
  visible: [isVisible: boolean]
  rename: [name: string]
  order: [kind: OrderKind]
}>()

/** 几何四项：键就是 `DashboardNodePayload` 上的字段名，模板里不再各写一遍。 */
const GEOMETRY_FIELDS: readonly { key: keyof NodeGeometry; label: string }[] = [
  { key: 'x', label: 'X (px)' },
  { key: 'y', label: 'Y (px)' },
  { key: 'w', label: '宽 (px)' },
  { key: 'h', label: '高 (px)' },
]

type OrderAction = { key: OrderKind; label: string; hint?: string }

// center 是「视口滚动定位到节点」，不动节点几何，文案与提示都按定位说
const ORDER_ACTIONS: readonly OrderAction[] = [
  { key: 'front', label: '置顶' },
  { key: 'forward', label: '上移一层' },
  { key: 'backward', label: '下移一层' },
  { key: 'back', label: '置底' },
  { key: 'center', label: '定位', hint: '定位到此节点' },
]

/** 钉位节点（页头 / 页脚）横向锁死，只许改高；钉住的那条边由动作层重新算回去。 */
const region = computed(() => props.manifest?.region)

/** 层序位置：`index` 是 0 起的底层序，面板上按「第几层 / 共几层」读。 */
const layerText = computed(() =>
  props.layer === null || props.layer.index < 0
    ? ''
    : `第 ${props.layer.index + 1} / ${props.layer.total} 层`,
)

/** 已经在这一头时把对应的按钮置灰：点了不动更像坏了。 */
function isOrderDisabled(kind: OrderKind): boolean {
  if (kind === 'center') return region.value !== undefined
  const layer = props.layer
  if (layer === null || layer.index < 0) return false
  if (kind === 'front' || kind === 'forward') {
    return layer.index === layer.total - 1
  }
  return layer.index === 0
}

/** 缺省 true：只有显式关掉的装饰 / 控件类模块才退出外观配置。 */
const isChromeConfigurable = computed(
  () => props.manifest?.chromeConfigurable !== false,
)

const label = computed(() => nodeLabelOf(props.node, () => props.manifest))

// DtInput 是受控件：不回写就会被拉回 prop，故名字走「草稿 + 提交」
const nameDraft = ref(label.value)
watch(
  () => [props.node.id, label.value] as const,
  () => {
    nameDraft.value = label.value
  },
)

function commitRename(): void {
  emit('rename', nameDraft.value)
  nameDraft.value = label.value
}

const geometry = computed<NodeGeometry>(() => ({
  x: props.node.x,
  y: props.node.y,
  w: props.node.w,
  h: props.node.h,
}))

/** 钉位节点的 x / 宽由排版算、y 由钉边与高度算出来，改了都会被夹回去，索性锁上。 */
function isGeometryLocked(key: keyof NodeGeometry): boolean {
  return region.value !== undefined && key !== 'h'
}

function writeGeometry(
  key: keyof NodeGeometry,
  next: number | undefined,
): void {
  if (next === undefined) return
  emit('geometry', { ...geometry.value, [key]: next }, true)
}

/** 模块级外观覆盖住在 `config_json.__cardStyle`；缺席给空袋。 */
const cardStyle = computed<CardChrome>(() => {
  const raw = props.node.configJson.__cardStyle
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw
    : {}
})

const canvasCard = useCanvasCardDefault()

/** 外观面板按模块能力适配的输入；开关判定用画布缺省 + 模块覆盖的有效值。 */
const cardFieldContext = computed<CardFieldContext>(() => ({
  chrome: props.manifest?.chrome ?? 'card',
  unsupportedKeys: new Set(props.manifest?.unsupportedChromeKeys ?? []),
  effective: mergeCardChrome(
    canvasCard === null ? null : canvasCard.value,
    cardStyle.value,
  ),
}))

/**
 * 整袋写回。**空袋要删键**：留一只 `{}` 在配置里，导出的 JSON 会多一段永远
 * 读不出差别的噪声，而且看上去像「配过了」。
 * @param next 面板给出的整袋新值
 */
function writeCardStyle(next: CardChrome): void {
  const cleaned: CardChrome = {}
  for (const [key, value] of chromeEntries(next)) {
    // false 与 0 都是合法取值：前者是模块级压过画布级的显式关闭，后者是几何值
    if (value === undefined || value === null || value === '') continue
    cleaned[key] = value
  }
  const hasAny = Object.keys(cleaned).length > 0
  emit('config', ['__cardStyle'], hasAny ? cleaned : undefined, false)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
    <section class="flex flex-col gap-2">
      <DtInput
        size="sm"
        label="节点名称"
        :model-value="nameDraft"
        :placeholder="manifest?.displayName ?? node.moduleType"
        data-test="node-name"
        @update:model-value="nameDraft = $event"
        @enter="commitRename"
        @blur="commitRename"
      />
      <p class="dt-common__meta">模块类型 {{ node.moduleType }}</p>
    </section>

    <section class="flex flex-col gap-2">
      <h3 class="dt-common__heading">布局</h3>
      <div class="grid grid-cols-2 gap-2" data-test="geometry">
        <DtField
          v-for="item in GEOMETRY_FIELDS"
          :key="item.key"
          :label="item.label"
          size="sm"
        >
          <DtNumberInput
            :model-value="geometry[item.key]"
            :disabled="isGeometryLocked(item.key)"
            size="sm"
            @update:model-value="writeGeometry(item.key, $event)"
          />
        </DtField>
      </div>
      <p v-if="region" class="dt-common__meta">
        {{ region === 'header' ? '页头' : '页脚' }}钉在{{
          region === 'header' ? '顶部' : '底部'
        }}、始终整宽，只有高度可改——改高就是拖{{
          region === 'header' ? '下' : '上'
        }}沿。
      </p>
      <div class="flex items-center gap-1">
        <span class="dt-common__meta">层序</span>
        <DtHelpTip
          text="只在同一个父层里比较：上移一层就是与紧挨着压住它的那个兄弟换位。"
          label="层序"
        />
        <span v-if="layerText" class="dt-common__meta ml-auto">
          {{ layerText }}
        </span>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <DtButton
          v-for="action in ORDER_ACTIONS"
          :key="action.key"
          size="sm"
          variant="outline"
          intent="neutral"
          :title="action.hint"
          :aria-label="action.hint"
          :data-test="`order-${action.key}`"
          :disabled="isOrderDisabled(action.key)"
          @click="emit('order', action.key)"
        >
          {{ action.label }}
        </DtButton>
      </div>
    </section>

    <section class="flex flex-col gap-2">
      <DtField
        label="初始可见"
        hint="只影响大屏运行时；编辑画布的显隐请用图层眼睛控制。"
        size="sm"
      >
        <DtSwitch
          :model-value="node.isVisible"
          size="sm"
          aria-label="初始可见"
          @update:model-value="emit('visible', $event)"
        />
      </DtField>
    </section>

    <section v-if="isChromeConfigurable" class="flex min-h-0 flex-col gap-2">
      <h3 class="dt-common__heading">
        卡片外观
        <DtHelpTip
          text="留空的项跟随画布上的「卡片外观缺省」；在这里填了才只改这一个模块。"
          label="卡片外观"
        />
      </h3>
      <CardStyleFields
        :model-value="cardStyle"
        :context="cardFieldContext"
        @update:model-value="writeCardStyle"
      />
    </section>
  </div>
</template>

<style scoped lang="scss">
.dt-common__heading {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.dt-common__meta {
  margin: 0;
  color: var(--text-disabled);
  font-size: 10px;
}
</style>
