/**
 * @fileoverview 样式预览的纯算料：一个临时预览节点、一袋示例读数，以及缩略框里那层
 * 等比缩放盒。样式面的常驻预览与新建向导共用这一份。
 *
 * ⚠ 示例读数经 `twin2dValues` 缝出来，不在这里另拼一张槽键表：派生槽求值与「同键以
 *   样式那一份为准」全仓只有那一份口径，另拼一张会让预览里的派生槽与墙上不是同一个
 *   数，而两处单看都对（§10.1、§14.2）。
 * ⚠ 造出来的节点与配置都是**临时**的，一个字都不写回文档：内置样式的编辑是文档里落一
 *   份同 id 的覆盖（§13.4），预览这一层要是也 materialize 一份就成了第二条落地路径。
 * ⚠ 一帧预览回的是**0 或 1 个** shot：归一化把这份种子丢掉时给空表，那一格整个不画。
 *   在这里补一份手写的缺省节点会让预览与真拖下去的节点长得不一样，且这一步零报错。
 */
import {
  TWIN_2D_NODE_BINDING_KEY,
  centerBoxOf,
  normalizeNodes,
  normalizeTwin2dConfig,
  twin2dBindingRows,
  twin2dValues,
} from '@dt/twin2d'
import type {
  Twin2dConfig,
  Twin2dNode,
  Twin2dNodeSize,
  Twin2dNodeStyle,
  Twin2dSlot,
  Twin2dSlotRead,
  Twin2dSlotValues,
  Twin2dState,
  Twin2dStatus,
} from '@dt/twin2d'
import type { CSSProperties } from 'vue'

/** 预览节点的 id；一份预览只有一个节点，重号无从谈起。 */
export const TWIN_2D_PREVIEW_NODE_ID = 'preview'

/** 示例读数缺省值。 */
export const TWIN_2D_PREVIEW_SAMPLE = 42

/** 布尔槽的示例读数：`enumMap` 的真值档按 1 查表。 */
const BOOLEAN_SAMPLE = 1

/** 交互态五档在面上叫什么。 */
export const TWIN_2D_PREVIEW_STATE_LABELS: Readonly<
  Record<Twin2dState, string>
> = {
  hover: '悬停',
  selected: '选中',
  alarm: '报警态',
  active: '活跃',
  flipped: '镜像',
}

/** 状态四档在面上叫什么。 */
export const TWIN_2D_PREVIEW_STATUS_LABELS: Readonly<
  Record<Twin2dStatus, string>
> = {
  online: '在线',
  offline: '离线',
  warning: '告警',
  alarm: '报警',
}

/** 一帧预览要摆的那些开关。 */
export interface Twin2dPreviewOptions {
  /** 覆盖尺寸；null = 跟样式自己的 `size` 走。 */
  size: Twin2dNodeSize | null
  /** 镜像位：`flipped` 变体要看得见效果，节点自己也得真的翻过来。 */
  flipped: boolean
  /** 数值槽的示例读数；null = 每个槽位都出自己的占位符。 */
  sample: number | null
}

/** 一帧预览：临时节点、它占的盒，以及喂给渲染件的那两路读数。 */
export interface Twin2dPreviewShot {
  node: Twin2dNode
  /** 节点在画布坐标里占的宽高，缩放盒按它算。 */
  size: Twin2dNodeSize
  /** 变体的 `slot` / `has` 两档与派生槽读它。 */
  slots: Twin2dSlotValues
  /** 按槽键取口径与读数，与 `Twin2dNodeBox` 上那一项同型。 */
  readSlot: (key: string) => Twin2dSlotRead | null
}

/**
 * 一个槽位的示例读数；`sample` 为 null 时一律无值，于是出这个槽自己的占位符。
 * ⚠ 有 `enumMap` 的槽必须喂表里**头一个键**：喂一个不在表里的数，映射查不到就退回
 * 数字直出，于是配了词表的槽在预览里显示的是裸数字，看着像词表没生效。
 * @param slot 槽位定义；查不到定义时按无值算
 * @param sample 数值槽的示例读数
 */
function sampleOf(
  slot: Twin2dSlot | undefined,
  sample: number | null,
): unknown {
  if (sample === null || slot === undefined) return null
  const firstKey = Object.keys(slot.enumMap)[0]
  if (firstKey !== undefined) {
    const asNumber = Number(firstKey)
    return Number.isFinite(asNumber) ? asNumber : firstKey
  }
  return slot.dataType === 'boolean' ? BOOLEAN_SAMPLE : sample
}

/**
 * 预览节点的种子：位姿归零，宽高给 0 就跟样式的 `size` 走。
 * @param style 当下生效的那一份样式
 * @param options 这一帧的开关
 */
function nodeSeed(
  style: Twin2dNodeStyle,
  options: Twin2dPreviewOptions,
): Record<string, unknown> {
  return {
    id: TWIN_2D_PREVIEW_NODE_ID,
    styleId: style.id,
    w: options.size?.w ?? 0,
    h: options.size?.h ?? 0,
    flipX: options.flipped,
  }
}

/**
 * 把示例读数摆成 `nodeValues` 那个数组槽的样子。
 * ⚠ 按行自己的 `index` 落位，不靠「过滤完就是 0..n-1」这条巧合：行序一变，每一行都
 * 会有值、每一层都不报错，但全都接错了槽位（同 `bindingValues.ts` 的文件头）。
 * @param config 临时配置，已归一化
 * @param defs 槽键到槽位定义
 * @param sample 数值槽的示例读数
 */
function nodeValueRows(
  config: Twin2dConfig,
  defs: ReadonlyMap<string, Twin2dSlot>,
  sample: number | null,
): unknown[] {
  const rows: unknown[] = []
  for (const row of twin2dBindingRows(config)) {
    if (row.slotKey !== TWIN_2D_NODE_BINDING_KEY) continue
    rows[row.index] = { value: sampleOf(defs.get(row.entitySlot), sample) }
  }
  return rows
}

/**
 * 算一帧预览；归一化把种子丢掉时给空表。
 * @param style 当下生效的那一份样式（文档 ∪ 预置库，调用方解析好）
 * @param options 这一帧的开关
 */
export function twin2dPreviewShots(
  style: Twin2dNodeStyle,
  options: Twin2dPreviewOptions,
): readonly Twin2dPreviewShot[] {
  const defs = new Map(style.slots.map((slot) => [slot.key, slot]))
  return normalizeNodes([nodeSeed(style, options)]).map((node) => {
    const config = normalizeTwin2dConfig({ styles: [style], nodes: [node] })
    const live = twin2dValues(config, {
      [TWIN_2D_NODE_BINDING_KEY]: nodeValueRows(config, defs, options.sample),
    })
    const box = centerBoxOf(node, style.size)
    return {
      node,
      size: { w: box.w, h: box.h },
      slots: live.slots[TWIN_2D_PREVIEW_NODE_ID] ?? new Map<string, unknown>(),
      readSlot: (key: string) => live.readSlot(TWIN_2D_PREVIEW_NODE_ID, key),
    }
  })
}

/**
 * 缩略框里那层缩放盒：按框等比缩，居中摆。
 * ⚠ `translate` 必须排在 `scale` 左边——CSS 的变换列表从右往左作用，排右边时那半格
 * 位移会跟着一起缩，缩得越狠偏得越多。
 * @param box 缩略框的边长（CSS 像素）
 * @param size 节点在画布坐标里占的宽高
 * @param maxZoom 最多放大几倍；接线点只有 6×6，按框铺满会糊成一大块
 */
export function twin2dPreviewFit(
  box: Twin2dNodeSize,
  size: Twin2dNodeSize,
  maxZoom: number,
): CSSProperties {
  const zoom = Math.min(box.w / size.w, box.h / size.h, maxZoom)
  return {
    width: `${size.w}px`,
    height: `${size.h}px`,
    transform: `translate(-50%, -50%) scale(${zoom})`,
  }
}
