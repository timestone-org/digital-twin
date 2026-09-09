<script setup lang="ts">
/**
 * @fileoverview twin-view 的渲染壳：把配置归一成 TwinConfig、把数组绑定按文档序
 * 缝回场景，再交给 3D 宿主。
 * ⚠ three 只能异步进：静态 import 会把整个 three 焊进任何引用本模块的入口静态图，
 * 不开孪生的大屏也要为它付首屏包体（DASHBOARD_DESIGN §5.4）。
 */
import type {
  InteractionEvent,
  ModuleMeta,
  ModuleSlotMeta,
} from '@dt/contracts'
import {
  TWIN_ANCHOR_BINDING_KEY,
  TWIN_ARROW_BINDING_KEY,
  TWIN_CONFIG_KEY,
  TWIN_FLOW_BINDING_KEY,
  TWIN_NAVIGATION_MODES,
  TWIN_PANEL_BINDING_KEY,
  TWIN_PART_BINDING_KEY,
  TWIN_PART_FIELD_BINDING_KEY,
  twinBindingRows,
  normalizeTwinConfig,
  twinSceneValues,
} from '@dt/twin-config'
import type { TwinBindingRow } from '@dt/twin-config'
import { DtHelpTip, DtNotice } from '@dt/ui'
import { computed, defineAsyncComponent, type CSSProperties } from 'vue'

import {
  readBoolean,
  readEnum,
  readNumber,
  readText,
} from '../../shared/config'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

const emit = defineEmits<{ interaction: [InteractionEvent] }>()

/**
 * 点中部件时上抛联动事件，`value` 是**部件 id**。
 * ⚠ 不上抛部件名：名字随时可改，而联动规则里存的那份不会跟着改，
 * 改完名字规则就静默失配——只表现为「点了没反应」。
 * ⚠ 远近两档各自的动作（切视角 / 弹详情）在 3D 宿主里就地做完了，这里只管联动。
 */
function onPartClick(part: { partId: string }): void {
  emit('interaction', { event: 'click', value: part.partId })
}

const CORNERS = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const

// 四角的偏移量与 3D 画布的边距同一套：12px 压上下、16px 压左右
const CORNER_OFFSETS: Record<(typeof CORNERS)[number], CSSProperties> = {
  'top-left': { top: '12px', left: '16px' },
  'top-right': { top: '12px', right: '16px' },
  'bottom-left': { bottom: '12px', left: '16px' },
  'bottom-right': { bottom: '12px', right: '16px' },
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

const TwinScene = defineAsyncComponent(async () => {
  const core = await import('@dt/three-core')
  return core.TwinScene
})

// ⚠ TwinScene 按引用比对这份配置，所以只能是 normalizeTwinConfig 的输出本身：
// 就地改字段不会重绘，而 computed 只在 config 换了对象时才产出新引用
const scene = computed(() => normalizeTwinConfig(props.config[TWIN_CONFIG_KEY]))
const title = computed(() => readText(props.config.title))
const showSceneTools = computed(() => readBoolean(props.config.showSceneTools))
const showStructureTree = computed(() =>
  readBoolean(props.config.showStructureTree),
)
const navigationMode = computed(() =>
  readEnum(props.config.navigationMode, TWIN_NAVIGATION_MODES, 'orbit'),
)

/**
 * 本模块消费的六个槽。
 * ⚠ 键在这里显式列一遍、不把整袋直接递下去：清单声明的槽键与渲染侧真正消费的
 * 槽键由契约测试逐一对上，而它只看得见本文件里的 `values[...]` 取法。
 * 少列一个键的表现是「那一路读数永远不来」，两边都不报错。
 */
const rows = computed(() => ({
  [TWIN_PART_BINDING_KEY]: props.values[TWIN_PART_BINDING_KEY],
  [TWIN_ANCHOR_BINDING_KEY]: props.values[TWIN_ANCHOR_BINDING_KEY],
  [TWIN_PANEL_BINDING_KEY]: props.values[TWIN_PANEL_BINDING_KEY],
  [TWIN_ARROW_BINDING_KEY]: props.values[TWIN_ARROW_BINDING_KEY],
  [TWIN_FLOW_BINDING_KEY]: props.values[TWIN_FLOW_BINDING_KEY],
  [TWIN_PART_FIELD_BINDING_KEY]: props.values[TWIN_PART_FIELD_BINDING_KEY],
}))

// ⚠ 缝合只走 `twinSceneValues` 这一处：对齐顺序在编辑视口那边也要用同一份，
// 各写各的就会「编辑器里核对过的对应关系，到大屏上全接错对象」
const live = computed(() => twinSceneValues(scene.value, rows.value))

interface TwinStatusReadout {
  tone: 'error' | 'pending' | 'empty'
  intent: 'danger' | 'warning' | 'neutral'
  text: string
  detail: string
}

type SlotEntry = [string, ModuleSlotMeta]

const bindingRows = computed(() => twinBindingRows(scene.value))

/** 查找 fieldKey 所属的实体行，含能量流的第二子槽。 */
function rowOf(fieldKey: string): TwinBindingRow | undefined {
  return bindingRows.value.find(
    (row) =>
      row.fieldKey === fieldKey ||
      fieldKey.startsWith(`${row.slotKey}[${row.index}].`),
  )
}

/** 把绑定 fieldKey 翻成孪生编辑器中可核对的实体名。 */
function slotLabel(fieldKey: string): string {
  const row = rowOf(fieldKey)
  return row === undefined ? fieldKey : `${row.label}（${row.entityId}）`
}

/** 将局部状态整理为按需展开的定位说明。 */
function slotDetails(entries: readonly SlotEntry[], fallback: string): string {
  return entries
    .map(([fieldKey, slot]) => {
      const message = slot.message?.trim() || fallback
      return `${slotLabel(fieldKey)}：${message}`
    })
    .join('；')
}

/** 优先交代可定位到实体的逐槽状态。 */
function bindingReadout(slots: readonly SlotEntry[]): TwinStatusReadout | null {
  const errors = slots.filter((entry) => entry[1].state === 'error')
  if (errors.length > 0) {
    return {
      tone: 'error',
      intent: 'danger',
      text: `${errors.length} 个绑定取数失败`,
      detail: slotDetails(errors, '取数失败'),
    }
  }
  const pending = slots.filter((entry) => entry[1].state === 'pending')
  if (pending.length > 0) {
    return {
      tone: 'pending',
      intent: 'warning',
      text: `${pending.length} 个绑定等待首帧`,
      detail: slotDetails(pending, '等待首帧'),
    }
  }
  return null
}

/** 没有逐槽细节时，仍交代整个模块的非正常状态。 */
function overallReadout(): TwinStatusReadout | null {
  switch (props.meta?.status) {
    case 'error':
      return {
        tone: 'error',
        intent: 'danger',
        text: props.meta.errorMessage ?? '孪生数据取不到',
        detail: '',
      }
    case 'loading':
      return {
        tone: 'pending',
        intent: 'warning',
        text: '绑定数据等待首帧',
        detail: '',
      }
    case 'empty':
      return {
        tone: 'empty',
        intent: 'neutral',
        text: '暂无绑定读数',
        detail: '',
      }
    default:
      return null
  }
}

const statusReadout = computed<TwinStatusReadout | null>(() => {
  const slots = Object.entries(props.meta?.slots ?? {})
  return bindingReadout(slots) ?? overallReadout()
})

const titleStyle = computed<CSSProperties>(() => ({
  ...CORNER_OFFSETS[readEnum(props.config.titlePosition, CORNERS, 'top-left')],
  fontSize: `${clamp(readNumber(props.config.titleFontSize, 16), 8, 72)}px`,
}))
</script>

<template>
  <div class="dt-twin">
    <TwinScene
      :config="scene"
      :values="live"
      :show-scene-tools="showSceneTools"
      :show-structure-tree="showStructureTree"
      :navigation-mode="navigationMode"
      :scene-title="title"
      @part-click="onPartClick"
    />
    <p v-if="title !== ''" class="dt-twin__title" :style="titleStyle">
      {{ title }}
    </p>
    <div
      v-if="statusReadout !== null"
      class="dt-twin__readout"
      :class="`dt-twin__${statusReadout.tone}`"
    >
      <DtNotice :intent="statusReadout.intent">
        {{ statusReadout.text }}
        <DtHelpTip
          v-if="statusReadout.detail !== ''"
          :text="statusReadout.detail"
          label="查看绑定详情"
        />
      </DtNotice>
    </div>
  </div>
</template>

<style scoped lang="scss">
.dt-twin {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

// 四角定位与字号由内联样式给，其余观感跟主题走
.dt-twin__title {
  position: absolute;
  margin: 0;
  // ⚠ 标题压在 3D 画面上，必须让指针穿过去：不让的话标题那一小块吃掉 pointerdown，
  // 表现是「在标题上按住转不动模型」，而这跟一行文字看起来毫无关系
  pointer-events: none;
  color: var(--text-primary);
  font-family: var(--font-display);
  letter-spacing: 0.06em;
  text-shadow: var(--fx-glow-title);
}

.dt-twin__readout {
  position: absolute;
  right: 16px;
  bottom: 12px;
  left: 16px;
}
</style>
