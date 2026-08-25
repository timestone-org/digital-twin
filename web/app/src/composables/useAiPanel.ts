/**
 * @fileoverview 把一个页面接进助手：登记工作面、探一次能力、管开合与会话，
 * 并在打开时把库里的历史回放到时间线上。
 *
 * ⚠ 工作面**挂载时登记、卸载时撤掉**。不撤的话，用户离开这一页之后助手仍握着
 * 一份指向已经没了的页面的句柄，下一次动手会改到一个不存在的东西上。
 *
 * ⚠ 探测失败一律当作「这套部署没有助手」，不是「暂时故障」：某些现场根本不
 * 部署 ai-assistant，那时入口就该干净地不出现，而不是弹一条红色告警
 * （features/ai/ports.ts）。
 *
 * ⚠ 对话放在这里而不是面板组件里：面板收起就卸载，对话不能跟着没。
 */
import { onMounted, onUnmounted, ref, type Ref } from 'vue'

import { createSession, readSession } from '@/api/assistant'
import {
  useAiConversation,
  type AiConversation,
} from '@/composables/useAiConversation'
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
  /** 这一页的那段对话。开合面板不动它，历史与计划都留在这。 */
  chat: AiConversation
  /** 打开面板；第一次打开时建会话，随后把库里的历史回放进时间线。 */
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

  const chat = useAiConversation(
    () => sessionId.value,
    () => ({ kind: surface.kind, label: surface.label }),
  )
  const replayer = createReplayer(chat)

  onUnmounted(() => {
    clearSurface(surface.kind)
    replayer.abort()
  })

  onMounted(() => {
    void probeInto(isAvailable)
  })

  async function open(): Promise<void> {
    // ⚠ 连点两下不能建两个会话：第二个会拿着一段空历史，而用户看不出
    // 自己在跟哪一个说话
    if (opening) return
    if (sessionId.value === null) {
      opening = true
      try {
        const created = await createSession(surface.kind, options.refId())
        sessionId.value = created.id
      } finally {
        opening = false
      }
    }
    isOpen.value = true
    const id = sessionId.value
    if (id !== null) await replayer.replay(id)
  }

  return {
    isAvailable,
    isOpen,
    sessionId,
    chat,
    open,
    close: () => {
      isOpen.value = false
    },
  }
}

/** 探一次能力，把「有没有助手」写进给定的开关。 */
async function probeInto(isAvailable: Ref<boolean>): Promise<void> {
  const ask = aiPorts()?.probe
  if (ask === undefined) return
  const capability = await ask()
  isAvailable.value = capability?.is_model_enabled === true
}

/**
 * 回放器：把库里的历史读回来灌进时间线。
 * ⚠ 竞态按后一次为准：上一次 readSession 还没回来又开了一次面板时，
 * 前一次在途的读取直接作废，不许旧响应盖掉新的。
 */
function createReplayer(chat: AiConversation): {
  replay: (sessionId: string) => Promise<void>
  abort: () => void
} {
  let inFlight: AbortController | null = null

  async function replay(sessionId: string): Promise<void> {
    // 本页生命周期里这段对话已经有内容（来回开合），或回合正跑着：都不灌
    if (chat.entries.value.length > 0 || chat.isRunning.value) return
    inFlight?.abort()
    const controller = new AbortController()
    inFlight = controller
    // 这一次仍是最新的一次，且没被掐掉
    const isCurrent = (): boolean =>
      inFlight === controller && !controller.signal.aborted
    try {
      const detail = await readSession(sessionId, controller.signal)
      if (isCurrent() && detail !== null) chat.restore(detail)
    } catch {
      // 回放失败不挡打开面板：空时间线照样能用，只是提醒一句
      if (isCurrent()) chat.note('没能读回这个会话的历史，先从空白继续')
    } finally {
      if (inFlight === controller) inFlight = null
    }
  }

  return {
    replay,
    abort: () => {
      inFlight?.abort()
    },
  }
}
