/**
 * @fileoverview 元数据轴的草稿：名称/描述/设计尺寸/外观袋（chromeJson）。
 * 与布局轴（节点树）各自判脏、各自保存；脏判按序列化基线比对。
 * ⚠ 只在大屏 id 变化时重播草稿：布局轴保存会推进行版本换新载荷，
 * 那时若无条件重播，用户没保存的元数据编辑就被静默冲掉了。
 */
import { computed, shallowRef, watch, type ComputedRef, type Ref } from 'vue'
import type { DashboardPayload } from '@dt/contracts'

import type { DashboardPatchInput } from '@/api/dashboard'

export interface EditorMetaDraft {
  name: string
  description: string | null
  designWidth: number
  designHeight: number
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
  /** 组装 PATCH 入参；不脏时给 null。 */
  toPatch: () => DashboardPatchInput | null
  /** 保存成功或重新加载后，用服务端载荷重播基线。 */
  reset: (payload: DashboardPayload) => void
}

function draftOf(payload: DashboardPayload): EditorMetaDraft {
  return {
    name: payload.name,
    description: payload.description,
    designWidth: payload.designWidth,
    designHeight: payload.designHeight,
    chromeJson: JSON.parse(JSON.stringify(payload.chromeJson)) as Record<
      string,
      unknown
    >,
  }
}

function serialized(draft: EditorMetaDraft | null): string {
  return draft === null ? '' : JSON.stringify(draft)
}

/** 草稿的两个写入口：整份不可变替换；`setChromeSection` 传 undefined 即删段。 */
function draftWriters(
  draft: Ref<EditorMetaDraft | null>,
): Pick<EditorMeta, 'setField' | 'setChromeSection'> {
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
  }
}

/** 组装 PATCH 入参；与基线一致（不脏）时给 null。 */
function patchOf(
  draft: EditorMetaDraft | null,
  baseline: string,
): DashboardPatchInput | null {
  if (draft === null || serialized(draft) === baseline) return null
  return {
    name: draft.name,
    description: draft.description,
    designWidth: draft.designWidth,
    designHeight: draft.designHeight,
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
    reset,
  }
}
