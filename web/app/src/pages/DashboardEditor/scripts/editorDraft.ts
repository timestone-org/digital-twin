/**
 * @fileoverview 编辑器的本地自动草稿：脏着的布局每 10 秒落一次 localStorage，
 * 崩溃或误关标签页后能捡回来。
 * ⚠ 服务器版本更新（updatedAt 变了）的草稿静默丢弃：那说明这张屏在别处又被
 * 保存过，旧草稿盖上去等于把别人的改动退回去。
 */
import type { DashboardNodePayload } from '@dt/contracts'

const PREFIX = 'dt.editor.draft.'

/** 自动落盘间隔。 */
export const DRAFT_INTERVAL_MS = 10_000

export interface EditorDraft {
  /** 草稿基于的服务端版本时刻；与当前载荷不一致即失效。 */
  basedOnUpdatedAt: string
  nodes: DashboardNodePayload[]
}

function keyOf(dashboardId: string): string {
  return `${PREFIX}${dashboardId}`
}

/** 写草稿；localStorage 不可用（无痕/配额满）时静默放弃。 */
export function writeDraft(
  dashboardId: string,
  basedOnUpdatedAt: string,
  nodes: readonly DashboardNodePayload[],
): void {
  try {
    localStorage.setItem(
      keyOf(dashboardId),
      JSON.stringify({
        basedOnUpdatedAt,
        nodes: [...nodes],
      } satisfies EditorDraft),
    )
  } catch {
    /* 丢一次自动草稿不该打断编辑 */
  }
}

/**
 * 读草稿；形状不对、或基于的版本已过期（服务端 updatedAt 不同）都给 null 并顺手清掉。
 */
export function readDraft(
  dashboardId: string,
  currentUpdatedAt: string,
): EditorDraft | null {
  try {
    const raw = localStorage.getItem(keyOf(dashboardId))
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as EditorDraft).basedOnUpdatedAt !== 'string' ||
      !Array.isArray((parsed as EditorDraft).nodes)
    ) {
      clearDraft(dashboardId)
      return null
    }
    const draft = parsed as EditorDraft
    if (draft.basedOnUpdatedAt !== currentUpdatedAt) {
      clearDraft(dashboardId)
      return null
    }
    return draft
  } catch {
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
