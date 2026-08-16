/**
 * @fileoverview 选中了什么 → 坐标轴手柄该挂在哪。纯查表，无 three 无 DOM。
 *
 * ⚠ 「能拖」不等于「有 position 字段」：信息牌锚定到锚点之后 `position` 静默
 * 不生效（渲染跟着锚点走），这时给手柄就是给一个拖了没反应的东西。
 */
import type { TwinConfig, Vec3 } from './types'

/** 能拖的三类实体。 */
export const GIZMO_KINDS = ['anchors', 'panels', 'arrows'] as const
export type TwinGizmoKind = (typeof GIZMO_KINDS)[number]

/** 手柄要摆到哪、按什么姿态。 */
export interface TwinGizmoTarget {
  kind: TwinGizmoKind
  id: string
  position: Vec3
  /** 箭头的朝向；另外两类没有朝向，给 null。 */
  direction: Vec3 | null
}

function isGizmoKind(kind: string): kind is TwinGizmoKind {
  return (GIZMO_KINDS as readonly string[]).includes(kind)
}

/**
 * 选中的这个实体该不该有手柄、手柄摆在哪。
 *
 * 给 null 的四种情况，各有各的原因：
 * - 选的是别的种类（部件靠模型节点、视点靠取当前机位、能流走途经锚点）
 * - id 找不到对应实体
 * - 信息牌锚定到了锚点：`position` 不生效，拖它没有任何效果
 * - 信息牌锚定的锚点已被删：这时 `position` 反而是生效的，所以**照给手柄**
 *
 * @param config 归一化后的孪生配置
 * @param selection 当前选中；null / 单例段一律给 null
 */
export function gizmoTargetOf(
  config: TwinConfig,
  selection: { kind: string; id?: string } | null,
): TwinGizmoTarget | null {
  if (selection === null || selection.id === undefined) return null
  const { kind, id } = selection
  if (!isGizmoKind(kind)) return null
  if (kind === 'anchors') return anchorTarget(config, id)
  if (kind === 'arrows') return arrowTarget(config, id)
  return panelTarget(config, id)
}

function anchorTarget(config: TwinConfig, id: string): TwinGizmoTarget | null {
  const anchor = config.anchors.find((item) => item.id === id)
  return anchor === undefined
    ? null
    : { kind: 'anchors', id, position: anchor.position, direction: null }
}

function arrowTarget(config: TwinConfig, id: string): TwinGizmoTarget | null {
  const arrow = config.arrows.find((item) => item.id === id)
  return arrow === undefined
    ? null
    : {
        kind: 'arrows',
        id,
        position: arrow.position,
        direction: arrow.direction,
      }
}

function panelTarget(config: TwinConfig, id: string): TwinGizmoTarget | null {
  const panel = config.panels.find((item) => item.id === id)
  if (panel === undefined) return null
  // 锚定生效时位置由锚点定，拖 position 不会有任何反应
  const anchored =
    panel.anchorId !== '' &&
    config.anchors.some((item) => item.id === panel.anchorId)
  return anchored
    ? null
    : { kind: 'panels', id, position: panel.position, direction: null }
}
