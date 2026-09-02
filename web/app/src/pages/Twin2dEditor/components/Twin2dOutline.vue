<script setup lang="ts">
/**
 * @fileoverview 左栏大纲：节点 / 连线 / 标注 / 样式四段可折叠列表。点一行选中，
 * Ctrl / ⌘ 点加选，每一段的动作条对**这一段当前选中的那一批**生效。
 *
 * ⚠ 样式那一段接的是 `styleFocus` 那条轴，与前三段的 `pick` **并行**，互不清空：
 * 合成一条的话「选着一个节点、同时编着它用的样式」就成了二选一，而那正是常态。
 * ⚠ 一切改动都由 ops 算出整份新配置再上抛（前三段走 R10 的三支，样式那两类走
 * `styleOps`），本层一个数组都不自己改：「恢复内置」= 删掉文档里那条同 id 的覆盖
 * （§13.4），在这一层就地删就是把那条口径复制出第二份。
 * ⚠ 每行都画主名加副名两段：只画 id 的话几十行下来认不出谁是谁。
 * ⚠ 层序即文档序，也是数组绑定的行号：动一次等于把它与相邻那条的取值来源对调，
 * 所以一律走 `change` 交给文档态重派绑定，不在这里就地改数组。
 */
import type { Pt, Twin2dConfig } from '@dt/twin2d'
import { DtButton, DtEmpty, DtIcon } from '@dt/ui'
import { computed, ref } from 'vue'

import { duplicateEdges, orderEdges, removeEdges } from '../scripts/edgeOps'
import type {
  Twin2dEditorSelection,
  Twin2dPickKind,
  Twin2dStyleKind,
} from '../scripts/editorSelection'
import { duplicateMarks, orderMarks, removeMarks } from '../scripts/markOps'
import { duplicateNodes, orderNodes, removeNodes } from '../scripts/nodeOps'
import type {
  Twin2dAdded,
  Twin2dCopied,
  Twin2dOrderMove,
} from '../scripts/nodeOps'
import {
  TWIN_2D_OUTLINE_ICONS,
  twin2dOutlineRows,
} from '../scripts/outlineRows'
import type { Twin2dOutlineRow } from '../scripts/outlineRows'
import {
  duplicateEdgeStyle,
  duplicateNodeStyle,
  removeEdgeStyle,
  removeNodeStyle,
  twin2dEdgeStyleOrigin,
  twin2dEdgeStyleUsage,
  twin2dNodeStyleOrigin,
  twin2dNodeStyleUsage,
} from '../scripts/styleOps'
import type { Twin2dStyleOrigin } from '../scripts/styleOps'
import { TWIN_2D_ENTITY_LABELS } from '../scripts/types'
import OutlineRow from './OutlineRow.vue'

/** 动作条上的一枚键。 */
interface RowAction {
  key: string
  label: string
  icon: string
  danger: boolean
  run: () => void
}

/** 样式那一段的一条：一行，加它自己那两枚动作键。 */
interface StyleEntry {
  row: Twin2dOutlineRow
  actions: readonly RowAction[]
}

/** 大纲的一段。 */
interface OutlineSection {
  key: string
  label: string
  icon: string
  empty: string
  hint: string
  rows: readonly Twin2dOutlineRow[]
  /** 动作条左边那句话，说清这几枚键对谁生效。 */
  scope: string
  actions: readonly RowAction[]
}

const props = defineProps<{
  /** 整份 2D 孪生配置；本层只读，改动一律整份上抛。 */
  config: Twin2dConfig
  /** 两条选中轴；画布与检查器共用同一份。 */
  selection: Twin2dEditorSelection
}>()

const emit = defineEmits<{
  /** 一次动作改出来的整份新配置，落一步撤销。 */
  change: [config: Twin2dConfig]
}>()

/** 四档来路各自的徽标；大纲只列文档里那些，所以只会落到中间两档。 */
const ORIGIN_BADGES: Readonly<Record<Twin2dStyleOrigin, string>> = {
  builtin: '内置',
  override: '覆盖内置',
  custom: '自建',
  missing: '',
}

/** 四档层序按「越靠后画得越上」摆：置顶在最左，置底在最右。 */
const ORDER_MOVES: readonly {
  move: Twin2dOrderMove
  icon: string
  label: string
}[] = [
  { move: 'front', icon: 'align-top', label: '置顶' },
  { move: 'forward', icon: 'chevron-up', label: '上移一层' },
  { move: 'backward', icon: 'chevron-down', label: '下移一层' },
  { move: 'back', icon: 'align-bottom', label: '置底' },
]

/** 收起来的那几段。 */
const collapsed = ref<Record<string, boolean>>({})

/**
 * 这一段是不是展开着。没记名的段一律展开。
 * @param key 段名
 */
function isOpen(key: string): boolean {
  return collapsed.value[key] !== true
}

/**
 * 折起或展开一段。
 * @param key 段名
 */
function toggle(key: string): void {
  collapsed.value = { ...collapsed.value, [key]: isOpen(key) }
}

/**
 * 复制这一段选中的那一批；副本按一格栅格错开。
 * ⚠ 连线那一类没有可加的位移（位置由两端定），副本与原件完全重合。
 * @param kind 这一类
 * @param ids 这一批
 */
function copyOf(kind: Twin2dPickKind, ids: readonly string[]): Twin2dCopied {
  const step = props.config.canvas.grid
  const at: Pt = { x: step, y: step }
  if (kind === 'nodes') return duplicateNodes(props.config, ids, at)
  if (kind === 'marks') return duplicateMarks(props.config, ids, at)
  return duplicateEdges(props.config, ids)
}

/**
 * 复制这一段选中的那一批，落定后选中转到副本上。
 * @param kind 这一类
 */
function onDuplicate(kind: Twin2dPickKind): void {
  const copied = copyOf(kind, props.selection.idsOf(kind))
  emit('change', copied.config)
  props.selection.selectMany(kind, copied.ids, false)
}

/**
 * 删掉这一段选中的那一批。
 * ⚠ 悬空的选中由页面那道 `prune` 摘，不在这里清：删节点会连带删掉挂在它上头的
 * 连线，只清被点名的那一类就会在连线那条轴上留下已经不存在的 id。
 * @param kind 这一类
 */
function onRemove(kind: Twin2dPickKind): void {
  const ids = props.selection.idsOf(kind)
  if (kind === 'nodes') emit('change', removeNodes(props.config, ids).config)
  else if (kind === 'marks')
    emit('change', removeMarks(props.config, ids).config)
  else emit('change', removeEdges(props.config, ids).config)
}

/**
 * 调这一段选中的那一批的层序。
 * @param kind 这一类
 * @param move 四档层序
 */
function onOrder(kind: Twin2dPickKind, move: Twin2dOrderMove): void {
  const ids = props.selection.idsOf(kind)
  if (kind === 'nodes') emit('change', orderNodes(props.config, ids, move))
  else if (kind === 'marks') emit('change', orderMarks(props.config, ids, move))
  else emit('change', orderEdges(props.config, ids, move))
}

/**
 * 造一枚动作键。
 * ⚠ 危险色按键名认：两段的删除都叫 `remove`，另开一个字段就是第二处真源。
 * @param key 动作名，也是它的测试钩子后缀
 * @param label 可读名，进 aria-label 与悬浮提示
 * @param icon 图标
 * @param run 按下去做什么
 */
function action(
  key: string,
  label: string,
  icon: string,
  run: () => void,
): RowAction {
  return { key, label, icon, danger: key === 'remove', run }
}

/**
 * 画布那三段的动作条。
 * @param kind 这一类
 * @param label 这一段的名字，进按钮的可读名
 */
function pickActions(
  kind: Twin2dPickKind,
  label: string,
): readonly RowAction[] {
  const orders = ORDER_MOVES.map((order) =>
    action(order.move, order.label, order.icon, () =>
      onOrder(kind, order.move),
    ),
  )
  return [
    action('copy', `复制选中的${label}`, 'copy', () => onDuplicate(kind)),
    ...orders,
    action('remove', `删除选中的${label}`, 'trash', () => onRemove(kind)),
  ]
}

/**
 * 这个样式 id 的来路；两条轴各查各的库。
 * @param kind 哪条样式轴
 * @param id 样式 id
 */
function originOf(kind: Twin2dStyleKind, id: string): Twin2dStyleOrigin {
  return kind === 'styles'
    ? twin2dNodeStyleOrigin(props.config, id)
    : twin2dEdgeStyleOrigin(props.config, id)
}

/**
 * 「删除」那一档的可读名：还有实体在用就把数目说出来。
 * ⚠ 样式删了，用它的节点不跟着删，只是再也解析不出样式——画面上那几个整个不见了。
 * 不把数目说出来，用户就是在没有提示的情况下按下去的。
 * @param kind 哪条样式轴
 * @param id 样式 id
 */
function dropLabel(kind: Twin2dStyleKind, id: string): string {
  const used =
    kind === 'styles'
      ? twin2dNodeStyleUsage(props.config, id).length
      : twin2dEdgeStyleUsage(props.config, id).length
  return used === 0 ? '删除这份样式' : `删除这份样式（还有 ${used} 个在用）`
}

/**
 * 删一份节点样式；同 id 有内置兜底时删掉的只是那条覆盖。
 * @param config 当前配置
 * @param id 样式 id
 */
function dropNodeStyle(config: Twin2dConfig, id: string): Twin2dConfig {
  return removeNodeStyle(config, id).config
}

/**
 * 删一份连线样式；同 id 有预置兜底时删掉的只是那条覆盖。
 * @param config 当前配置
 * @param id 样式 id
 */
function dropEdgeStyle(config: Twin2dConfig, id: string): Twin2dConfig {
  return removeEdgeStyle(config, id).config
}

/**
 * 复制落定：焦点转到副本上，好接着改它的名字。
 * @param kind 哪条样式轴
 * @param added 复制的结果
 */
function onStyleCopy(kind: Twin2dStyleKind, added: Twin2dAdded): void {
  emit('change', added.config)
  // ⚠ 加不进去时不动焦点：交一个落不到实处的 id 出去，右栏会画一份不存在的样式
  if (added.id !== null) props.selection.focusStyle(kind, added.id)
}

/**
 * 样式那一段的一条：行、来路徽标与两枚动作键。
 * ⚠ 覆盖内置的那一档给「恢复内置」、自建的那一档给「删除」——两档摆同一个按钮会让
 * 用户以为自建样式也能恢复，而它删掉就没了。两者落到同一支 `remove*`：同 id 有内置
 * 兜底时，删掉那条覆盖**就是**恢复内置（§13.4）。
 * @param kind 哪条样式轴
 * @param style 这一份样式
 * @param copy 复制这一类样式的那一支
 * @param drop 删这一类样式的那一支
 */
function styleEntry<T extends { id: string; name: string }>(
  kind: Twin2dStyleKind,
  style: T,
  copy: (config: Twin2dConfig, source: T) => Twin2dAdded,
  drop: (config: Twin2dConfig, id: string) => Twin2dConfig,
): StyleEntry {
  const focus = props.selection.styleFocus.value
  const origin = originOf(kind, style.id)
  const away = (): void => emit('change', drop(props.config, style.id))
  return {
    row: {
      key: `${kind}:${style.id}`,
      title: style.name !== '' ? style.name : style.id,
      note: `${TWIN_2D_ENTITY_LABELS[kind]} · ${style.id}`,
      icon:
        kind === 'styles'
          ? TWIN_2D_OUTLINE_ICONS.nodes
          : TWIN_2D_OUTLINE_ICONS.edges,
      badge: ORIGIN_BADGES[origin],
      warn: false,
      selected: focus !== null && focus.kind === kind && focus.id === style.id,
      pick: () => props.selection.focusStyle(kind, style.id),
    },
    actions: [
      action('copy', '复制一份', 'copy', () =>
        onStyleCopy(kind, copy(props.config, style)),
      ),
      origin === 'override'
        ? action('restore', '恢复内置', 'refresh-cw', away)
        : action('remove', dropLabel(kind, style.id), 'trash', away),
    ],
  }
}

/** 样式那一段只列**文档里**那些：预置库整份在调色板里，不在大纲里重列一遍。 */
const styleEntries = computed<readonly StyleEntry[]>(() => [
  ...props.config.styles.map((style) =>
    styleEntry('styles', style, duplicateNodeStyle, dropNodeStyle),
  ),
  ...props.config.edgeStyles.map((style) =>
    styleEntry('edgeStyles', style, duplicateEdgeStyle, dropEdgeStyle),
  ),
])

/**
 * 画布那三段之一。
 * @param kind 这一类
 */
function pickSection(kind: Twin2dPickKind): OutlineSection {
  const label = TWIN_2D_ENTITY_LABELS[kind]
  const picked = props.selection.idsOf(kind).length
  return {
    key: kind,
    label,
    icon: TWIN_2D_OUTLINE_ICONS[kind],
    empty: `还没有${label}`,
    hint: '',
    rows: twin2dOutlineRows(props.config, props.selection, kind),
    scope: `选中 ${picked}`,
    actions: picked === 0 ? [] : pickActions(kind, label),
  }
}

const sections = computed<readonly OutlineSection[]>(() => {
  const focused = styleEntries.value.find((entry) => entry.row.selected)
  return [
    pickSection('nodes'),
    pickSection('edges'),
    pickSection('marks'),
    {
      key: 'styles',
      label: '样式',
      icon: 'palette',
      empty: '还没有自建样式',
      hint: '从调色板拖一个下来，改过之后就会落在这里。',
      rows: styleEntries.value.map((entry) => entry.row),
      scope: '正在编辑',
      actions: focused?.actions ?? [],
    },
  ]
})
</script>

<template>
  <div class="flex flex-col gap-2" data-test="twin2d-outline">
    <section v-for="section in sections" :key="section.key">
      <button
        type="button"
        class="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-2xs text-text-secondary hover:bg-accent-primary/10"
        :aria-expanded="isOpen(section.key)"
        :data-test="`outline-toggle-${section.key}`"
        @click="toggle(section.key)"
      >
        <DtIcon
          :name="isOpen(section.key) ? 'chevron-down' : 'chevron-right'"
          :size="12"
        />
        <DtIcon :name="section.icon" :size="12" />
        <span class="truncate">{{ section.label }}</span>
        <span class="ml-auto text-text-disabled">{{
          section.rows.length
        }}</span>
      </button>

      <div
        v-if="isOpen(section.key) && section.actions.length > 0"
        class="flex items-center gap-0.5 px-1 pb-1 text-3xs text-text-disabled"
        :data-test="`outline-actions-${section.key}`"
      >
        <span class="mr-auto">{{ section.scope }}</span>
        <DtButton
          v-for="entry in section.actions"
          :key="entry.key"
          size="xs"
          variant="ghost"
          :intent="entry.danger ? 'danger' : 'primary'"
          :icon="entry.icon"
          :aria-label="entry.label"
          :title="entry.label"
          :data-test="`outline-${entry.key}-${section.key}`"
          @click="entry.run()"
        />
      </div>

      <template v-if="isOpen(section.key)">
        <DtEmpty
          v-if="section.rows.length === 0"
          size="inline"
          class="flex-wrap"
          :title="section.empty"
          :hint="section.hint"
          :data-test="`outline-empty-${section.key}`"
        />
        <OutlineRow
          v-for="row in section.rows"
          :key="row.key"
          :title="row.title"
          :note="row.note"
          :icon="row.icon"
          :badge="row.badge"
          :warn="row.warn"
          :selected="row.selected"
          :data-test="`outline-row-${row.key}`"
          @pick="row.pick($event)"
        />
      </template>
    </section>
  </div>
</template>
