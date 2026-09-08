/**
 * @fileoverview 元数据轴的草稿：名称、描述、设计尺寸、主题和外观袋。
 * 与布局轴各自判脏和保存；只在大屏 id 变化时重播草稿，避免冲掉未保存编辑。
 */
import { computed, shallowRef, watch, type ComputedRef, type Ref } from 'vue'
import type { DashboardPayload } from '@dt/contracts'

export interface EditorMetaDraft {
  name: string
  description: string | null
  designWidth: number
  designHeight: number
  themeJson: Record<string, unknown>
  chromeJson: Record<string, unknown>
}

export interface EditorMeta {
  draft: Ref<EditorMetaDraft | null>
  isDirty: ComputedRef<boolean>
  /** 改一个标量字段。 */
  setField: <K extends 'name' | 'description' | 'designWidth' | 'designHeight'>(
    key: K,
    value: EditorMetaDraft[K],
  ) => void
  /** 整段替换 chromeJson 的一节（card/editor/interactions）；undefined 删段。 */
  setChromeSection: (section: string, value: unknown) => void
  /** 选择单屏主题；null 恢复跟随系统，保留主题袋的其它字段。 */
  setTheme: (id: string | null) => void
  /** 恢复本地草稿中的整份主题袋。 */
  setThemeJson: (themeJson: Record<string, unknown>) => void
  /** 组装完整元数据 PATCH 快照；不脏时给 null。 */
  toPatch: () => EditorMetaDraft | null
  /** 接纳保存回包，保留提交后产生的新草稿。 */
  acceptSaved: (payload: DashboardPayload, submitted: EditorMetaDraft) => void
  /** 载入时用服务端载荷替换草稿和基线。 */
  reset: (payload: DashboardPayload) => void
}

function draftOf(payload: DashboardPayload): EditorMetaDraft {
  return {
    name: payload.name,
    description: payload.description,
    designWidth: payload.designWidth,
    designHeight: payload.designHeight,
    themeJson: { ...payload.themeJson },
    // JSON 往返只做深拷贝：入参本就是 Record<string, unknown>，顶层形状不变
    chromeJson: JSON.parse(JSON.stringify(payload.chromeJson)) as Record<
      string,
      unknown
    >,
  }
}

function serialized(draft: EditorMetaDraft | null): string {
  if (draft === null) return ''
  // ⚠ 删除后重添 __base 会改变键序，主题袋按固定顺序比较才能正确识别回选原主题。
  const themeJson = Object.fromEntries(
    Object.entries(draft.themeJson).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  )
  return JSON.stringify({ ...draft, themeJson })
}

/** 草稿写入口：整份不可变替换；`setChromeSection` 传 undefined 即删段。 */
function draftWriters(
  draft: Ref<EditorMetaDraft | null>,
): Pick<
  EditorMeta,
  'setField' | 'setChromeSection' | 'setTheme' | 'setThemeJson'
> {
  return {
    setField: (key, value) => {
      if (draft.value === null) return
      draft.value = { ...draft.value, [key]: value }
    },
    setChromeSection: (section, value) => {
      const current = draft.value
      if (current === null) return
      const rest = { ...current.chromeJson }
      delete rest[section]
      draft.value = {
        ...current,
        chromeJson: value === undefined ? rest : { ...rest, [section]: value },
      }
    },
    setTheme: (id) => {
      const current = draft.value
      if (current === null) return
      const themeJson = { ...current.themeJson }
      if (id === null) delete themeJson.__base
      else themeJson.__base = id
      draft.value = { ...current, themeJson }
    },
    setThemeJson: (themeJson) => {
      if (draft.value === null) return
      draft.value = { ...draft.value, themeJson: { ...themeJson } }
    },
  }
}

/** 组装 PATCH 入参；与基线一致（不脏）时给 null。 */
function patchOf(
  draft: EditorMetaDraft | null,
  baseline: string,
): EditorMetaDraft | null {
  if (draft === null || serialized(draft) === baseline) return null
  return {
    name: draft.name,
    description: draft.description,
    designWidth: draft.designWidth,
    designHeight: draft.designHeight,
    themeJson: draft.themeJson,
    chromeJson: draft.chromeJson,
  }
}

export function useEditorMeta(
  dashboard: Ref<DashboardPayload | null>,
): EditorMeta {
  const draft = shallowRef<EditorMetaDraft | null>(null)
  const baseline = shallowRef('')

  function reset(payload: DashboardPayload): void {
    draft.value = draftOf(payload)
    baseline.value = serialized(draft.value)
  }

  function acceptSaved(
    payload: DashboardPayload,
    submitted: EditorMetaDraft,
  ): void {
    const saved = draftOf(payload)
    // ⚠ 保存期间的新编辑不属于本次回包，只有仍等于提交快照才替换草稿。
    if (serialized(draft.value) === serialized(submitted)) draft.value = saved
    baseline.value = serialized(saved)
  }

  watch(
    () => dashboard.value?.id ?? null,
    () => {
      const current = dashboard.value
      if (current === null) {
        draft.value = null
        baseline.value = ''
        return
      }
      reset(current)
    },
    { immediate: true },
  )

  const isDirty = computed(() => serialized(draft.value) !== baseline.value)

  return {
    draft,
    isDirty,
    ...draftWriters(draft),
    toPatch: () => patchOf(draft.value, baseline.value),
    acceptSaved,
    reset,
  }
}
