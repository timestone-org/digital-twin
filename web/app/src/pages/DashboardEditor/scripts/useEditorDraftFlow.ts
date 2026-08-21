/**
 * @fileoverview 本地自动草稿与离开守卫：布局或元数据脏着每 10 秒落一次、
 * 关页与站内跳转前先落草稿再确认、进屏时提议恢复（布局部分是一步可撤销的改动）。
 */
import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import type { DashboardPayload } from '@dt/contracts'

import type { DashboardEditor } from '@/composables/useDashboardEditor'
import {
  DRAFT_INTERVAL_MS,
  clearDraft,
  readDraft,
  writeDraft,
} from './editorDraft'
import type { EditorMeta, EditorMetaDraft } from './useEditorMeta'

export interface DraftFlowDeps {
  editor: DashboardEditor
  dashboard: Ref<DashboardPayload | null>
  meta: EditorMeta
  /** chromeJson.editor 段的回灌口：吸附与栅格要经 chrome 的归一化 setter。 */
  restoreEditorSection: (section: unknown) => void
  confirm: {
    ask: (input: {
      title: string
      message: string
      confirmText: string
      danger: boolean
    }) => Promise<boolean>
  }
}

/** 草稿流的运行态：依赖加上两个到处要用的判定/落盘出口。 */
interface DraftFlowCtx {
  deps: DraftFlowDeps
  isAnyDirty: () => boolean
  flushDraft: () => void
}

/** 两个 JSON 值是否同构；恢复时内容相同就不写，免得键序变化把元数据误判成脏。 */
function isSameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

/** 把草稿里的元数据经既有 setter 逐项回灌；editor 段（吸附/栅格）走归一化口。 */
function restoreMeta(deps: DraftFlowDeps, saved: EditorMetaDraft): void {
  const { meta } = deps
  meta.setField('name', saved.name)
  meta.setField('description', saved.description)
  meta.setField('designWidth', saved.designWidth)
  meta.setField('designHeight', saved.designHeight)
  const current = meta.draft.value?.chromeJson ?? {}
  const sections = new Set([
    ...Object.keys(current),
    ...Object.keys(saved.chromeJson),
  ])
  for (const section of sections) {
    const value = saved.chromeJson[section]
    if (isSameJson(current[section], value)) continue
    if (section === 'editor') deps.restoreEditorSection(value)
    else meta.setChromeSection(section, value)
  }
}

async function offerRestore(
  ctx: DraftFlowCtx,
  current: DashboardPayload,
): Promise<void> {
  const { deps } = ctx
  const draft = readDraft(current.id, current.updatedAt)
  if (draft === null) return
  const restore = await deps.confirm.ask({
    title: '恢复本地草稿',
    message:
      '这张屏上次编辑时留有未保存的草稿（含页面设置与联动规则），要恢复吗？布局改动可用撤销退回。',
    confirmText: '恢复',
    danger: false,
  })
  if (!restore) {
    clearDraft(current.id)
    return
  }
  // ⚠ 布局恢复走一次 apply 成为可撤销的一步；元数据轴没有撤销栈，退回靠不恢复或再编辑
  deps.editor.apply(() => draft.nodes)
  if (draft.meta !== null) restoreMeta(deps, draft.meta)
}

/** 关页兜底：先落草稿，脏着就让浏览器问一句。 */
function beforeUnloadOf(ctx: DraftFlowCtx): (event: BeforeUnloadEvent) => void {
  return (event) => {
    ctx.flushDraft()
    if (!ctx.isAnyDirty()) return
    // ⚠ 文案由浏览器出，自定义字符串早被忽略；returnValue 是老 WebKit 的开关，少了它直接放行
    event.preventDefault()
    event.returnValue = ''
  }
}

/** 站内跳转守卫：脏着先落草稿再问；确认离开后草稿仍在，回来可选择恢复。 */
function installLeaveGuard(ctx: DraftFlowCtx): void {
  onBeforeRouteLeave(async () => {
    if (!ctx.isAnyDirty()) return true
    ctx.flushDraft()
    return ctx.deps.confirm.ask({
      title: '离开编辑器',
      message:
        '有未保存的改动。当前内容已存成本地草稿，回来时可选择恢复；直接离开不会保存到服务器。',
      confirmText: '仍要离开',
      danger: true,
    })
  })
}

/** 装上草稿流与离开守卫；返回「立即落一次」给保存链路复用。 */
export function useEditorDraftFlow(deps: DraftFlowDeps): {
  flushDraft: () => void
} {
  const { editor, dashboard, meta } = deps
  let draftTimer: ReturnType<typeof setInterval> | null = null

  function isAnyDirty(): boolean {
    return editor.isDirty.value || meta.isDirty.value
  }

  function flushDraft(): void {
    const current = dashboard.value
    if (current === null || !isAnyDirty()) return
    writeDraft(
      current.id,
      current.updatedAt,
      editor.nodes.value,
      meta.draft.value,
    )
  }

  const ctx: DraftFlowCtx = { deps, isAnyDirty, flushDraft }
  const onBeforeUnload = beforeUnloadOf(ctx)
  installLeaveGuard(ctx)

  watch(
    () => dashboard.value?.id ?? null,
    () => {
      const current = dashboard.value
      if (current !== null) void offerRestore(ctx, current)
    },
  )

  onMounted(() => {
    draftTimer = setInterval(flushDraft, DRAFT_INTERVAL_MS)
    window.addEventListener('beforeunload', onBeforeUnload)
    const current = dashboard.value
    if (current !== null) void offerRestore(ctx, current)
  })

  onBeforeUnmount(() => {
    if (draftTimer !== null) clearInterval(draftTimer)
    draftTimer = null
    window.removeEventListener('beforeunload', onBeforeUnload)
    flushDraft()
  })

  return { flushDraft }
}
