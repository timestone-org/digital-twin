/**
 * @fileoverview 编辑器里的助手面板：登记工作面、探一次能力、管开合与会话。
 *
 * ⚠ 工作面**挂载时登记、卸载时撤掉**。不撤的话，用户离开这一页之后助手仍握着
 * 一份指向已经没了的编辑器的句柄，下一次动手会改到一个不存在的画布上。
 *
 * ⚠ 探测失败一律当作「这套部署没有助手」，不是「暂时故障」：某些现场根本不
 * 部署 ai-assistant，那时入口就该干净地不出现，而不是弹一条红色告警。
 */
import { onMounted, onUnmounted, ref, type Ref } from 'vue'
import type { GetModuleManifest } from '@dt/runtime'

import { createSession } from '@/api/assistant'
import type { DashboardEditor } from '@/composables/useDashboardEditor'
import { aiPorts } from '@/features/ai/ports'
import { clearSurface, setSurface } from '@/features/ai/surfaces'
import { createEditorSurface } from './aiSurface'
import type { EditorActions } from './editorActions'

const SURFACE = 'dashboard-editor'

export interface AiPanelDeps {
  editor: DashboardEditor
  actions: EditorActions
  getManifest: GetModuleManifest
  dashboardId: () => string | null
}

export interface AiPanel {
  /** 这套部署到底有没有助手。为假时入口不出现。 */
  isAvailable: Ref<boolean>
  isOpen: Ref<boolean>
  sessionId: Ref<string | null>
  /** 打开面板；第一次打开时建会话。 */
  open: () => Promise<void>
  close: () => void
}

/**
 * 把编辑器接进助手。
 * @param deps 编辑器的草稿、动作层、清单解析器与当前大屏 id
 */
export function useAiPanel(deps: AiPanelDeps): AiPanel {
  const isAvailable = ref(false)
  const isOpen = ref(false)
  const sessionId = ref<string | null>(null)
  let opening = false

  setSurface(createEditorSurface(deps))
  onUnmounted(() => {
    clearSurface(SURFACE)
  })

  onMounted(() => {
    void probe()
  })

  async function probe(): Promise<void> {
    const ask = aiPorts()?.probe
    if (ask === undefined) return
    const capability = await ask()
    isAvailable.value = capability?.is_model_enabled === true
  }

  async function open(): Promise<void> {
    // ⚠ 连点两下不能建两个会话：第二个会拿着一段空历史，而用户看不出
    // 自己在跟哪一个说话
    if (opening) return
    if (sessionId.value !== null) {
      isOpen.value = true
      return
    }
    opening = true
    try {
      const created = await createSession(SURFACE, deps.dashboardId())
      sessionId.value = created.id
      isOpen.value = true
    } finally {
      opening = false
    }
  }

  return {
    isAvailable,
    isOpen,
    sessionId,
    open,
    close: () => {
      isOpen.value = false
    },
  }
}
