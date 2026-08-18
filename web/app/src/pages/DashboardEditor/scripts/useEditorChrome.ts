/**
 * @fileoverview 页面设置面的接线：吸附与虚拟栅格的「内存态 ⇄ chromeJson.editor」
 * 双向同步，加上设置面各改动到元数据草稿的落笔。
 * ⚠ 只在大屏 id 变化时从载荷重播吸附配置：保存后重播会把用户刚改的吸附又弹回去。
 */
import { computed, provide, ref, watch, type Ref } from 'vue'
import type {
  CardChrome,
  DashboardPayload,
  InteractionRule,
} from '@dt/contracts'
import { reconcileSetActiveGroups } from '@dt/runtime'

import {
  normalizeEditorGrid,
  normalizeSnapConfig,
  type EditorGridConfig,
  type SnapConfig,
} from '@/features/dashboard/canvasSnap'
import { EDITOR_PROJECT_ID_KEY } from '@/features/dashboard/editorContext'
import type { EditorMeta } from './useEditorMeta'

export interface EditorChrome {
  snap: Ref<SnapConfig>
  grid: Ref<EditorGridConfig>
  setSnap: (patch: Partial<SnapConfig>) => void
  setGrid: (patch: Partial<EditorGridConfig>) => void
  setField: (
    key: 'name' | 'description' | 'designWidth' | 'designHeight',
    value: string | number | null,
  ) => void
  setCard: (card: CardChrome) => void
  setInteractions: (rules: InteractionRule[]) => void
}

function editorSectionOf(payload: DashboardPayload): {
  snap?: Partial<SnapConfig>
  grid?: Partial<EditorGridConfig>
} {
  const raw = payload.chromeJson.editor
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw
    : {}
}

/** 标量字段落笔：描述允许清成 null，名称只收字符串，设计尺寸只收数字。 */
function writeField(
  meta: EditorMeta,
  key: 'name' | 'description' | 'designWidth' | 'designHeight',
  value: string | number | null,
): void {
  if (key === 'description') {
    meta.setField('description', typeof value === 'string' ? value : null)
    return
  }
  if (key === 'name') {
    if (typeof value === 'string') meta.setField('name', value)
    return
  }
  if (typeof value === 'number') meta.setField(key, value)
}

/** 直接落进元数据草稿的三个写入口，与内存态的吸附/栅格无关。 */
function metaWriters(
  meta: EditorMeta,
): Pick<EditorChrome, 'setField' | 'setCard' | 'setInteractions'> {
  return {
    setField: (key, value) => {
      writeField(meta, key, value)
    },
    setCard: (card) => {
      // 空袋 = 全部回到平台默认，把整段删掉，导出的 JSON 不留噪声
      meta.setChromeSection(
        'card',
        Object.keys(card).length === 0 ? undefined : card,
      )
    },
    setInteractions: (rules) => {
      // 陈旧的互斥组先清（选项集接缝暂无来源，一律不动），空表删段
      const next = reconcileSetActiveGroups(rules, () => null)
      meta.setChromeSection(
        'interactions',
        next.length === 0 ? undefined : next,
      )
    },
  }
}

export function useEditorChrome(
  dashboard: Ref<DashboardPayload | null>,
  meta: EditorMeta,
): EditorChrome {
  const snap = ref(normalizeSnapConfig(null))
  const grid = ref(normalizeEditorGrid(null))

  // 属性面板里按项目取数的控件（挑另一张大屏这类）只认这个注入键
  provide(
    EDITOR_PROJECT_ID_KEY,
    computed(() => dashboard.value?.projectId ?? null),
  )

  watch(
    () => dashboard.value?.id ?? null,
    () => {
      const current = dashboard.value
      const section = current === null ? {} : editorSectionOf(current)
      snap.value = normalizeSnapConfig(section.snap ?? null)
      grid.value = normalizeEditorGrid(section.grid ?? null)
    },
    { immediate: true },
  )

  /** 吸附与栅格一起整段落进 chromeJson.editor，保存时随元数据轴入库。 */
  function persist(): void {
    meta.setChromeSection('editor', {
      snap: snap.value,
      grid: grid.value,
    })
  }

  return {
    snap,
    grid,
    setSnap: (patch) => {
      snap.value = normalizeSnapConfig({ ...snap.value, ...patch })
      persist()
    },
    setGrid: (patch) => {
      grid.value = normalizeEditorGrid({ ...grid.value, ...patch })
      persist()
    },
    ...metaWriters(meta),
  }
}
