<script setup lang="ts">
/**
 * @fileoverview 样式里那棵图元树：层级摊开成一列，选中一枚、拖着改层序与跨级搬家，
 * 加一排「新增」与每行的复制 / 上下移 / 删除。摊平与落点算在 `primTreeRows`。
 *
 * ⚠ 每一行都把 **kind 与 id** 摆出来：id 是节点级覆盖补丁与变体补丁的寻址键，
 *   两处都按它找图元，看不见 id 的话那两处只能靠猜。
 * ⚠ 深度上限 6：归一化对超深的那一层是**归空数组**，所以拖太深的表现是「保存之后
 *   子树没了」。这里在放手之前就问 `twin2dPrimMoveBlock`，拦住并说出为什么。
 * ⚠ 树上一行行往下 = 文档序，而文档序就是绘制序：**越靠后画得越上**。所以「在树上
 *   上移」等于层序里的 `backward`。两个名字对不上会让人按反，而按反了只是图变了
 *   个样，不报错。
 * ⚠ 图元自己的 `z` 落成 CSS `z-index`，与文档序不一致时看到的是 `z` 说了算——
 *   「上移一格没反应」通常是有人给这一枝配了 `z`。
 * ⚠ 一切改动都由 `primOps` 算出整份新配置再上抛，本层一个数组都不自己改：样式是
 *   引用式可覆盖的（§13.4），就地改就是把「什么时候落一份覆盖」复制出第二份判断。
 */
import { TWIN_2D_PRIM_KINDS } from '@dt/twin2d'
import type { Twin2dConfig, Twin2dNodeStyle, Twin2dPrimKind } from '@dt/twin2d'
import { DtButton, DtEmpty, DtIcon, DtNotice } from '@dt/ui'
import { computed, ref } from 'vue'

import type { Twin2dOrderMove } from '../../scripts/nodeOps'
import {
  TWIN_2D_PRIM_MOVE_BLOCK_LABELS,
  addPrim,
  duplicatePrim,
  findTwin2dPrim,
  movePrim,
  orderPrims,
  removePrim,
  twin2dPrimMoveBlock,
  twin2dPrimSpotBlock,
} from '../../scripts/primOps'
import type { Twin2dPrimSpot } from '../../scripts/primOps'
import {
  TWIN_2D_PRIM_KIND_LABELS,
  TWIN_2D_PRIM_SEEDS,
  twin2dPrimAddAt,
  twin2dPrimRows,
} from '../../scripts/primTreeRows'
import type { Twin2dPrimRow } from '../../scripts/primTreeRows'

const props = defineProps<{
  /** 整份配置；改动整份产出往上 emit。 */
  config: Twin2dConfig
  /** 当下生效的那一份样式：文档里的优先，落不到才回预置库。 */
  nodeStyle: Twin2dNodeStyle
  /** 选中的那一枚图元 id；空串 = 一枚都没选。 */
  selected: string
}>()

const emit = defineEmits<{
  /** 一次动作改出来的整份新配置，落一帧撤销。 */
  change: [config: Twin2dConfig]
  /** 选中了一枚图元；空串 = 取消选中。画布怎么高亮由装配层接。 */
  pick: [primId: string]
}>()

/**
 * 拖拽载荷的类型。
 * ⚠ 拖出与接住都在本组件里，所以它只为**让浏览器认这是一次真的拖拽**而设
 * （一个 `setData` 都不给的话，起手那一下会被 Firefox 直接取消）。哪一枚正被拖着
 * 的真源是 `dragging`：`dragover` 阶段按规范读不到 dataTransfer 里的数据，
 * 两处都当真源的话，「能不能落下」与「真正落下的是哪一枚」就会各说各话。
 */
const PRIM_DRAG_MIME = 'application/x-twin2d-prim-id'

/** 一层缩进多少像素。 */
const INDENT_PX = 12

/** 行尾那几枚键。 */
interface Twin2dRowAction {
  /** 也是这一枚键的测试钩子前缀。 */
  key: string
  /** 可读名，进 aria-label 与悬浮提示。 */
  label: string
  icon: string
  danger: boolean
  run: (primId: string) => void
}

/** 正被拖着的那一枚；空串 = 没在拖，或拖进来的是别处的东西。 */
const dragging = ref('')

/** 指针正悬在哪一道落点上；空串 = 不在任何一道上。 */
const hovering = ref('')

/** 这一手为什么放不下；空串 = 放得下。 */
const blocked = ref('')

const rows = computed<readonly Twin2dPrimRow[]>(() =>
  twin2dPrimRows(props.nodeStyle.prims),
)

const addAt = computed(() =>
  twin2dPrimAddAt(props.nodeStyle.prims, props.selected),
)

/** 落点收不下一枚新图元时的说法；空串 = 加得进去。 */
const addBlocked = computed(
  () =>
    TWIN_2D_PRIM_MOVE_BLOCK_LABELS[
      twin2dPrimSpotBlock(props.nodeStyle, addAt.value.spot, 0)
    ],
)

/**
 * 缩进到第几层。
 * @param depth 层深
 */
function indent(depth: number): string {
  return `${depth * INDENT_PX}px`
}

/** 一次拖拽到此为止。 */
function reset(): void {
  dragging.value = ''
  hovering.value = ''
  blocked.value = ''
}

/**
 * 起手拖一行。
 * @param event 那一下 dragstart
 * @param primId 拖的是哪一枚
 */
function onDragStart(event: DragEvent, primId: string): void {
  dragging.value = primId
  const transfer = event.dataTransfer ?? null
  if (transfer === null) return
  transfer.setData(PRIM_DRAG_MIME, primId)
  transfer.effectAllowed = 'move'
}

/**
 * 指针悬在一道落点上。
 * ⚠ 放得下时必须 `preventDefault`：不拦掉浏览器的缺省动作，`drop` 根本不会发生，
 * 表现是拖了半天松手没反应。
 * @param event 那一下 dragover
 * @param spot 这道落点
 * @param key 这道落点的标识，用来画高亮
 */
function onOver(event: DragEvent, spot: Twin2dPrimSpot, key: string): void {
  if (dragging.value === '') return
  const block = twin2dPrimMoveBlock(props.nodeStyle, dragging.value, spot)
  hovering.value = block === 'none' ? key : ''
  blocked.value = TWIN_2D_PRIM_MOVE_BLOCK_LABELS[block]
  if (block === 'none') event.preventDefault()
}

/**
 * 指针离开一道落点。
 * @param key 这道落点的标识
 */
function onLeave(key: string): void {
  if (hovering.value === key) hovering.value = ''
  blocked.value = ''
}

/**
 * 在一道落点上松手。
 * ⚠ 拦得住的那几档由 `movePrim` 自己再判一遍、原样返回入参那份配置，所以这里只按
 * 引用判要不要上抛：在这里重算一遍判据，两处判据迟早会漂开。
 * @param event 那一下 drop
 * @param spot 这道落点
 */
function onDrop(event: DragEvent, spot: Twin2dPrimSpot): void {
  event.preventDefault()
  const primId = dragging.value
  reset()
  if (primId === '') return
  const next = movePrim(props.config, props.nodeStyle, primId, spot)
  if (next !== props.config) emit('change', next)
}

/**
 * 悬到一行盒上：落点是「当它的最后一个子」。
 * @param event 那一下 dragover
 * @param row 这一行
 */
function onOverRow(event: DragEvent, row: Twin2dPrimRow): void {
  if (!row.isBox) return
  onOver(event, { parentId: row.id, index: row.childCount }, `in:${row.id}`)
}

/**
 * 在一行盒上松手。
 * @param event 那一下 drop
 * @param row 这一行
 */
function onDropRow(event: DragEvent, row: Twin2dPrimRow): void {
  if (!row.isBox) return
  onDrop(event, { parentId: row.id, index: row.childCount })
}

/**
 * 新增一枚图元，落定后选中转到它身上，好接着改它。
 * @param kind 四种之一
 */
function onAdd(kind: Twin2dPrimKind): void {
  const added = addPrim(
    props.config,
    props.nodeStyle,
    addAt.value.spot,
    TWIN_2D_PRIM_SEEDS[kind],
  )
  // ⚠ 加不进去时不动选中：交一个落不到实处的 id 出去，右栏会画一枚不存在的图元
  if (added.id === null) return
  emit('change', added.config)
  emit('pick', added.id)
}

/**
 * 复制一枚（连它的子树），选中转到副本上。
 * @param primId 要复制的那一枚
 */
function onDuplicate(primId: string): void {
  const added = duplicatePrim(props.config, props.nodeStyle, primId)
  if (added.id === null) return
  emit('change', added.config)
  emit('pick', added.id)
}

/**
 * 调一枚在**同一层**里的次序。
 * @param primId 要动的那一枚
 * @param move 四档层序
 */
function onOrder(primId: string, move: Twin2dOrderMove): void {
  const next = orderPrims(props.config, props.nodeStyle, primId, move)
  if (next !== props.config) emit('change', next)
}

/**
 * 删一枚（连它的子树）。
 * ⚠ 选中的那一枚可能就在被删的子树里：不摘掉的话，右栏画着一枚已经不在的图元，
 * 改哪一项都写不回去且不报错。
 * @param primId 要删的那一枚
 */
function onRemove(primId: string): void {
  const at = findTwin2dPrim(props.nodeStyle.prims, primId)
  const next = removePrim(props.config, props.nodeStyle, primId)
  if (next === props.config) return
  emit('change', next)
  if (at !== null && findTwin2dPrim([at.prim], props.selected) !== null) {
    emit('pick', '')
  }
}

const ROW_ACTIONS: readonly Twin2dRowAction[] = [
  {
    key: 'copy',
    label: '复制这一枚（连子树）',
    icon: 'copy',
    danger: false,
    run: onDuplicate,
  },
  {
    key: 'up',
    label: '在树上上移一格（文档序在前 = 画在下面）',
    icon: 'chevron-up',
    danger: false,
    run: (primId) => onOrder(primId, 'backward'),
  },
  {
    key: 'down',
    label: '在树上下移一格（文档序在后 = 画在上面）',
    icon: 'chevron-down',
    danger: false,
    run: (primId) => onOrder(primId, 'forward'),
  },
  {
    key: 'remove',
    label: '删掉这一枚（连子树）',
    icon: 'trash',
    danger: true,
    run: onRemove,
  },
]
</script>

<template>
  <div class="flex flex-col gap-1" data-test="prim-tree">
    <DtNotice
      v-if="blocked !== ''"
      intent="warning"
      icon="alert-triangle"
      data-test="prim-block"
    >
      {{ blocked }}
    </DtNotice>

    <DtEmpty
      v-if="nodeStyle.prims.length === 0"
      size="inline"
      title="这份样式还没有图元"
      hint="加一枚盒或矢量，它就是这个符号画出来的样子。"
      data-test="prim-empty"
    />

    <template v-for="row in rows" :key="row.key">
      <div
        class="h-1 rounded"
        :class="hovering === `gap:${row.key}` ? 'bg-accent-primary' : ''"
        :style="{ marginLeft: indent(row.depth) }"
        :data-test="`prim-gap-${row.key}`"
        @dragover="onOver($event, row.spot, `gap:${row.key}`)"
        @dragleave="onLeave(`gap:${row.key}`)"
        @drop="onDrop($event, row.spot)"
      />

      <div
        v-if="row.hasRow"
        class="flex items-center gap-1 rounded border bg-surface-sunken px-1 py-0.5"
        :class="
          hovering === `in:${row.id}`
            ? 'border-accent-primary'
            : 'border-border-subtle'
        "
        :style="{ marginLeft: indent(row.depth) }"
        draggable="true"
        :data-test="`prim-row-${row.id}`"
        @dragstart="onDragStart($event, row.id)"
        @dragend="reset"
        @dragover="onOverRow($event, row)"
        @dragleave="onLeave(`in:${row.id}`)"
        @drop="onDropRow($event, row)"
      >
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-1 rounded px-1 text-left text-2xs"
          :class="
            row.id === selected
              ? 'bg-accent-primary/10 text-accent-on-surface'
              : 'text-text-secondary'
          "
          :aria-pressed="row.id === selected"
          :title="`${row.kindLabel} ${row.id}`"
          :data-test="`prim-pick-${row.id}`"
          @click="emit('pick', row.id)"
        >
          <DtIcon :name="row.icon" :size="12" />
          <span class="shrink-0">{{ row.kindLabel }}</span>
          <span class="truncate text-text-disabled">{{ row.id }}</span>
          <span
            v-if="row.note !== ''"
            class="shrink-0 text-3xs text-text-disabled"
          >
            {{ row.note }}
          </span>
        </button>

        <DtButton
          v-for="act in ROW_ACTIONS"
          :key="act.key"
          size="xs"
          variant="ghost"
          :intent="act.danger ? 'danger' : 'primary'"
          :icon="act.icon"
          :aria-label="act.label"
          :title="act.label"
          :data-test="`prim-${act.key}-${row.id}`"
          @click="act.run(row.id)"
        />
      </div>
    </template>

    <div class="flex flex-wrap items-center gap-1 pt-1">
      <span class="mr-auto text-3xs text-text-disabled" data-test="prim-add-at">
        {{ addBlocked === '' ? addAt.hint : addBlocked }}
      </span>
      <DtButton
        v-for="kind in TWIN_2D_PRIM_KINDS"
        :key="kind"
        size="xs"
        variant="soft"
        intent="neutral"
        :disabled="addBlocked !== ''"
        :title="`新增一枚${TWIN_2D_PRIM_KIND_LABELS[kind]}`"
        :data-test="`prim-add-${kind}`"
        @click="onAdd(kind)"
      >
        {{ TWIN_2D_PRIM_KIND_LABELS[kind] }}
      </DtButton>
    </div>
  </div>
</template>
