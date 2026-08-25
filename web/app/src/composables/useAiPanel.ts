/**
 * @fileoverview 把一个页面接进助手：登记工作面、探一次能力、管开合与会话。
 *
 * ⚠ 工作面**挂载时登记、卸载时撤掉**。不撤的话，用户离开这一页之后助手仍握着
 * 一份指向已经没了的页面的句柄，下一次动手会改到一个不存在的东西上。
 *
 * ⚠ 探测失败一律当作「这套部署没有助手」，不是「暂时故障」：某些现场根本不
 * 部署 ai-assistant，那时入口就该干净地不出现，而不是弹一条红色告警
 * （features/ai/ports.ts）。
 */
import { onMounted, onUnmounted, ref, type Ref } from 'vue'

import { createSession } from '@/api/assistant'
import { aiPorts } from '@/features/ai/ports'
import { clearSurface, setSurface } from '@/features/ai/surfaces'
import type { AiSurface } from '@/features/ai/surfaces'

export interface AiPanelOptions {
  /** 这一页的工作面。⚠ 只在装配时调一次，句柄要一直有效。 */
  surface: () => AiSurface
  /** 工作面指向的那个东西的 id（大屏 id / 台账 id）；还没加载出来时给 null。 */
  refId: () => string | null
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

/** 把一个页面接进助手。 */
export function useAiPanel(options: AiPanelOptions): AiPanel {
  const isAvailable = ref(false)
  const isOpen = ref(false)
  const sessionId = ref<string | null>(null)
  let opening = false

  const surface = options.surface()
  setSurface(surface)
  onUnmounted(() => {
    clearSurface(surface.kind)
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
      const created = await createSession(surface.kind, options.refId())
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
