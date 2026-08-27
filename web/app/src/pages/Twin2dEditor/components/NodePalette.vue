<script setup lang="ts">
/**
 * @fileoverview 样式库调色板：预置库与文档里的自建样式合并后按 `category` 分组，
 * 每一项画一张**真实缩略图**，拖到画布上新建节点，点一下也能加一个。
 *
 * ⚠ 同 id 以文档为准（§13.4），且改过的那一份仍站在预置库的位置上：另起一栏放
 * 「我改过的」会让同一个符号在库里出现两次，而两处点下去得到的是同一个 styleId。
 * ⚠ 缩略图走 `Twin2dNodeBox` 缩放渲染，不画占位方块：调色板上看到的就该是拖下去
 * 会得到的东西，而占位方块把「这个样式长什么样」推给了用户去试。
 * ⚠ 预览节点的缺省值一律经 `normalizeNodes` 取，不在这里抄一份：抄的那份与归一化
 * 一旦不一致，缩略图与真拖下去的节点就长得不一样，且这一步零报错。
 * ⚠ 本层不挂 sprite 宿主（`Twin2dIconSprite`）：那是画布壳的活，两处都挂会让同一份
 * symbol 在文档里重号。
 */
import {
  TWIN_2D_BUILTIN_NODE_STYLE_MAP,
  Twin2dNodeBox,
  normalizeNodes,
} from '@dt/twin2d'
import type { Twin2dNode, Twin2dNodeSize, Twin2dNodeStyle } from '@dt/twin2d'
import { DtEmpty, DtIcon, DtInput } from '@dt/ui'
import { computed, ref } from 'vue'
import type { CSSProperties } from 'vue'

import { TWIN_2D_STYLE_DRAG_MIME } from '../scripts/paletteDrag'
import { twin2dMergedNodeStyles } from '../scripts/styleOps'

/** 调色板上的一项。 */
interface PaletteItem {
  id: string
  /** 摆出来的名字；样式没起名就退到 id，免得卡片上只剩一张图。 */
  name: string
  /** 缩略图渲染用的预览节点：位姿归零、宽高留 0（跟样式的 size 走）。 */
  node: Twin2dNode
  style: Twin2dNodeStyle
  /** 来历标记；预置库原样那些不标。 */
  badge: string
  /** 缩略图里那层缩放盒的内联样式。 */
  fit: CSSProperties
}

/** 一个分组。 */
interface PaletteGroup {
  key: string
  label: string
  items: readonly PaletteItem[]
}

const props = defineProps<{
  /** 文档里的节点样式；与预置库合并显示，同 id 以这一份为准。 */
  styles: readonly Twin2dNodeStyle[]
}>()

const emit = defineEmits<{
  /** 点了一项：在画布中央加一个这个样式的节点。 */
  add: [styleId: string]
}>()

/** 缩略图的框与卡片最窄多少（CSS 像素）；三个数一起交给样式表，免得两处各写一份。 */
const THUMB_W = 78
const THUMB_H = 46
const CARD_MIN = 88

/** 缩略图最多放大几倍：接线点只有 6×6，按框铺满会糊成一大块。 */
const MAX_ZOOM = 2

/**
 * 预置库那几个 `category` 的显示名。
 * ⚠ `category` 只用于这里分栏，不参与任何渲染判断（§7 #55）；认不出的原样显示，
 * 用户自建的分类照样成栏。
 */
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  source: '热源',
  vessel: '容器',
  terminal: '末端',
  exchanger: '换热',
  label: '标注',
  circuit: '电路符号',
}

const keyword = ref('')

/** 几何尺寸下发给样式表：列宽换挡的刻度与缩略图的高都只有这一处取值。 */
const metrics: CSSProperties = {
  '--t2p-card': `${CARD_MIN}px`,
  '--t2p-thumb-w': `${THUMB_W}px`,
  '--t2p-thumb-h': `${THUMB_H}px`,
}

/**
 * 一个分类的显示名。
 * @param category 分类字符串
 */
function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? (category === '' ? '未分类' : category)
}

/** 合并后的整份样式库；口径与样式库抽屉同一支（`twin2dMergedNodeStyles`）。 */
const merged = computed<readonly Twin2dNodeStyle[]>(() =>
  twin2dMergedNodeStyles(props.styles),
)

/**
 * 这份样式的来历标记。
 * @param id 样式 id
 */
function badgeOf(id: string): string {
  if (!props.styles.some((style) => style.id === id)) return ''
  return TWIN_2D_BUILTIN_NODE_STYLE_MAP.has(id) ? '覆盖内置' : '自建'
}

/**
 * 缩略图里那层缩放盒：按框等比缩，居中摆。
 * ⚠ `translate` 必须排在 `scale` 左边——CSS 的变换列表从右往左作用，排右边时那
 * 半格位移会跟着一起缩，缩得越狠偏得越多。
 * @param size 样式的缺省尺寸
 */
function fitStyle(size: Twin2dNodeSize): CSSProperties {
  const zoom = Math.min(THUMB_W / size.w, THUMB_H / size.h, MAX_ZOOM)
  return {
    width: `${size.w}px`,
    height: `${size.h}px`,
    transform: `translate(-50%, -50%) scale(${zoom})`,
  }
}

/**
 * 一项。
 * @param style 这份样式
 * @param node 它的预览节点
 */
function itemOf(style: Twin2dNodeStyle, node: Twin2dNode): PaletteItem {
  return {
    id: style.id,
    name: style.name !== '' ? style.name : style.id,
    node,
    style,
    badge: badgeOf(style.id),
    fit: fitStyle(style.size),
  }
}

/** 关键字过滤：名字、id 与分类名都算。 */
const visible = computed<readonly Twin2dNodeStyle[]>(() => {
  const needle = keyword.value.trim().toLowerCase()
  if (needle === '') return merged.value
  return merged.value.filter((style) =>
    `${style.name} ${style.id} ${categoryLabel(style.category)}`
      .toLowerCase()
      .includes(needle),
  )
})

/**
 * 每项一个预览节点。
 * ⚠ 一张图一次 `normalizeNodes`：交出来的那条恰好是这份样式的预览节点，
 * 归一化丢掉它时这一项就整个不出现，不必再写一支「查不到怎么办」的死分支。
 */
const items = computed<readonly PaletteItem[]>(() =>
  visible.value.flatMap((style) =>
    normalizeNodes([{ id: style.id, styleId: style.id }]).map((node) =>
      itemOf(style, node),
    ),
  ),
)

/** 按分类分栏；栏序 = 分类头一次出现的次序。 */
const groups = computed<readonly PaletteGroup[]>(() => {
  const buckets = new Map<string, PaletteItem[]>()
  for (const item of items.value) {
    const bucket = buckets.get(item.style.category)
    if (bucket === undefined) buckets.set(item.style.category, [item])
    else bucket.push(item)
  }
  return [...buckets].map(([key, list]) => ({
    key,
    label: categoryLabel(key),
    items: list,
  }))
})

/**
 * 起手拖一项。
 * @param event 那一下 dragstart
 * @param styleId 拖的是哪份样式
 */
function onDragStart(event: DragEvent, styleId: string): void {
  if (event.dataTransfer === null) return
  event.dataTransfer.setData(TWIN_2D_STYLE_DRAG_MIME, styleId)
  event.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <div class="flex flex-col gap-2" :style="metrics" data-test="node-palette">
    <DtInput
      v-model="keyword"
      size="sm"
      placeholder="搜索样式"
      aria-label="搜索样式"
      data-test="palette-search"
    >
      <template #leading><DtIcon name="search" :size="12" /></template>
    </DtInput>

    <DtEmpty
      v-if="groups.length === 0"
      size="inline"
      icon="palette"
      title="没有匹配的样式"
      hint="换个关键字试试。"
      data-test="palette-empty"
    />

    <section v-for="group in groups" :key="group.key">
      <h3 class="t2p-cat">
        <span class="truncate">{{ group.label }}</span>
        <span class="t2p-count">{{ group.items.length }}</span>
      </h3>
      <div class="t2p-grid">
        <button
          v-for="item in group.items"
          :key="item.id"
          type="button"
          class="t2p-item"
          draggable="true"
          :title="`${item.name} · 拖入画布或点击添加`"
          :data-test="`palette-item-${item.id}`"
          @click="emit('add', item.id)"
          @dragstart="onDragStart($event, item.id)"
        >
          <span class="t2p-thumb">
            <span class="t2p-fit" :style="item.fit">
              <Twin2dNodeBox
                :node="item.node"
                :node-style="item.style"
                :id-prefix="`palette-${item.id}`"
              />
            </span>
          </span>
          <span class="t2p-name">{{ item.name }}</span>
          <span v-if="item.badge !== ''" class="t2p-badge">{{
            item.badge
          }}</span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.t2p-cat {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.t2p-count {
  flex: none;
  margin-left: auto;
  color: var(--text-disabled);
  font-weight: 400;
}

// 列数交给 auto-fill 自己算：左栏是可拖的，钉死列数就只有一个宽度好看
.t2p-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--t2p-card), 1fr));
  gap: 4px;
}

.t2p-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
  padding: 4px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-primary);
  cursor: grab;

  &:hover {
    border-color: var(--accent-primary);
  }

  &:active {
    cursor: grabbing;
  }
}

// 缩略图框：溢出的部分（画在盒外的标签这类）裁掉，整块不吃指针，
// 免得图元自己的指针设置吃掉起手那一下
.t2p-thumb {
  position: relative;
  display: block;
  overflow: hidden;
  width: var(--t2p-thumb-w);
  height: var(--t2p-thumb-h);
  pointer-events: none;
}

.t2p-fit {
  position: absolute;
  top: 50%;
  left: 50%;
}

.t2p-name {
  max-width: 100%;
  font-size: 11px;
  line-height: 1.2;
  text-align: center;
  overflow-wrap: anywhere;
}

.t2p-badge {
  padding: 0 4px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-disabled);
  font-size: 10px;
}
</style>
