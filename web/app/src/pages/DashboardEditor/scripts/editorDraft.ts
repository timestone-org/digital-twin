/**
 * @fileoverview 编辑器的本地自动草稿：脏着的布局与元数据（名称/设计尺寸/chromeJson
 * 整包，含联动规则）每 10 秒落一次 localStorage，崩溃或误关标签页后能捡回来。
 * ⚠ 服务器版本更新（updatedAt 变了）的草稿静默丢弃：那说明这张屏在别处又被
 * 保存过，旧草稿盖上去等于把别人的改动退回去。
 */
import type { DashboardNodePayload } from '@dt/contracts'

import type { EditorMetaDraft } from './useEditorMeta'

const PREFIX = 'dt.editor.draft.'

/** 草稿结构版本：形状一变就加一，读到别的版本一律丢弃（对齐剪贴板的版本守卫）。 */
const DRAFT_VERSION = 2

/** 自动落盘间隔。 */
export const DRAFT_INTERVAL_MS = 10_000

export interface EditorDraft {
  version: typeof DRAFT_VERSION
  /** 草稿基于的服务端版本时刻；与当前载荷不一致即失效。 */
  basedOnUpdatedAt: string
  nodes: DashboardNodePayload[]
  /** 元数据轴的草稿；写草稿那刻元数据还没加载出来时为 null。 */
  meta: EditorMetaDraft | null
}

function keyOf(dashboardId: string): string {
  return `${PREFIX}${dashboardId}`
}

/** 写草稿；localStorage 不可用（无痕/配额满）时静默放弃。 */
export function writeDraft(
  dashboardId: string,
  basedOnUpdatedAt: string,
  nodes: readonly DashboardNodePayload[],
  meta: EditorMetaDraft | null,
): void {
  try {
    localStorage.setItem(
      keyOf(dashboardId),
      JSON.stringify({
        version: DRAFT_VERSION,
        basedOnUpdatedAt,
        nodes: [...nodes],
        meta,
      } satisfies EditorDraft),
    )
  } catch {
    /* 丢一次自动草稿不该打断编辑 */
  }
}

/** 元数据载荷的形状校验；chromeJson 的深结构交给恢复链路的归一化 setter。 */
function isDraftMeta(value: unknown): value is EditorMetaDraft {
  if (typeof value !== 'object' || value === null) return false
  // Partial 断言只用于逐字段验型，验过才放行
  const shape = value as Partial<EditorMetaDraft>
  return (
    typeof shape.name === 'string' &&
    (shape.description === null || typeof shape.description === 'string') &&
    typeof shape.designWidth === 'number' &&
    typeof shape.designHeight === 'number' &&
    typeof shape.chromeJson === 'object' &&
    shape.chromeJson !== null &&
    !Array.isArray(shape.chromeJson)
  )
}

/** 草稿形状校验：版本不符（含旧版无版本号的草稿）一律不认。 */
function isDraft(value: unknown): value is EditorDraft {
  if (typeof value !== 'object' || value === null) return false
  // Partial 断言只用于逐字段验型；节点深结构不复验——草稿只回灌本人刚编辑的数据
  const shape = value as Partial<EditorDraft>
  return (
    shape.version === DRAFT_VERSION &&
    typeof shape.basedOnUpdatedAt === 'string' &&
    Array.isArray(shape.nodes) &&
    (shape.meta === null || isDraftMeta(shape.meta))
  )
}

/**
 * 读草稿；形状或版本不对、或基于的版本已过期（服务端 updatedAt 不同）都给 null
 * 并顺手清掉。
 */
export function readDraft(
  dashboardId: string,
  currentUpdatedAt: string,
): EditorDraft | null {
  try {
    const raw = localStorage.getItem(keyOf(dashboardId))
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isDraft(parsed) || parsed.basedOnUpdatedAt !== currentUpdatedAt) {
      clearDraft(dashboardId)
      return null
    }
    return parsed
  } catch {
    // 坏 JSON 与坏形状同口径清掉，否则损坏条目每次进屏都重复 parse 失败
    clearDraft(dashboardId)
    return null
  }
}

/** 清掉草稿：保存成功后与失效时用。 */
export function clearDraft(dashboardId: string): void {
  try {
    localStorage.removeItem(keyOf(dashboardId))
  } catch {
    /* 同上 */
  }
}
