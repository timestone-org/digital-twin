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
import type { AssistantModelProfile } from '@dt/contracts'

import { createSession } from '@/api/assistant'
import { newComposeState, type ComposeState } from '@/composables/useAiCompose'
import {
  useAiConversation,
  type AiConversation,
} from '@/composables/useAiConversation'
import {
  adoptRow,
  fillDefaults,
  newModelChoice,
  pickModel,
  type ModelChoice,
} from '@/composables/useAiModelChoice'
import { createReplayer } from '@/composables/useAiReplayer'
import { aiPorts } from '@/features/ai/ports'
import { clearSurface, setSurface } from '@/features/ai/surfaces'
import type { AiSurface } from '@/features/ai/surfaces'

export { newComposeState, type ComposeState } from '@/composables/useAiCompose'
export type { ModelChoice } from '@/composables/useAiModelChoice'

export interface AiPanelOptions {
  /** 这一页的工作面。⚠ 只在装配时调一次，句柄要一直有效。 */
  surface: () => AiSurface
  /** 工作面指向的那个东西的 id（大屏 id / 台账 id）；还没加载出来时给 null。 */
  refId: () => string | null
}

export interface AiPanel {
  /** 这套部署到底有没有助手。为假时入口不出现。 */
  isAvailable: Ref<boolean>
  /** 这套部署接了哪几路模型。空 = 不摆那个下拉。 */
  models: Ref<AssistantModelProfile[]>
  /**
   * 附件收哪些后缀。⚠ 服务端下发的那一份，前端不写死——两份漂开的表现是
   * 「选得中的文件传上去被拒」，而两边单看都对。
   */
  attachmentSuffixes: Ref<string[]>
  /** 这个会话选了哪一路。 */
  choice: Ref<ModelChoice>
  /** 换一路模型。⚠ 落到会话上，不是只改这一屏。 */
  pickModel: (next: ModelChoice) => Promise<void>
  isOpen: Ref<boolean>
  sessionId: Ref<string | null>
  /** 这一页的那段对话。开合面板不动它，历史与计划都留在这。 */
  chat: AiConversation
  /** 输入区的草稿与附件。开合面板同样不动它。 */
  compose: ComposeState
  /** 打开面板；第一次打开时建会话，随后把库里的历史回放进时间线。 */
  open: () => Promise<void>
  close: () => void
}

/** 把一个页面接进助手。 */
export function useAiPanel(options: AiPanelOptions): AiPanel {
  const isAvailable = ref(false)
  const models = ref<AssistantModelProfile[]>([])
  const attachmentSuffixes = ref<string[]>([])
  const choice = newModelChoice()
  const isOpen = ref(false)
  const sessionId = ref<string | null>(null)

  const surface = options.surface()
  setSurface(surface)

  const chat = useAiConversation(
    () => sessionId.value,
    () => ({ kind: surface.kind, label: surface.label }),
  )
  const compose = newComposeState()
  const replayer = createReplayer(chat)

  onUnmounted(() => {
    clearSurface(surface.kind)
    replayer.abort()
  })

  onMounted(() => {
    void probeInto({ isAvailable, models, attachmentSuffixes, choice })
  })

  const open = openerOf({
    surfaceKind: surface.kind,
    refId: options.refId,
    sessionId,
    choice,
    isOpen,
    replay: replayer.replay,
  })

  return {
    isAvailable,
    models,
    attachmentSuffixes,
    choice,
    pickModel: (next) => pickModel(next, choice, sessionId),
    isOpen,
    sessionId,
    chat,
    compose,
    open,
    close: () => {
      isOpen.value = false
    },
  }
}

/**
 * 造「打开面板」这个动作：第一次打开建会话，随后把库里的历史回放进时间线。
 * ⚠ 连点两下不能建两个会话：第二个会拿着一段空历史，而用户看不出
 * 自己在跟哪一个说话。
 */
function openerOf(parts: {
  surfaceKind: AiSurface['kind']
  refId: () => string | null
  sessionId: Ref<string | null>
  choice: Ref<ModelChoice>
  isOpen: Ref<boolean>
  replay: (sessionId: string) => Promise<void>
}): () => Promise<void> {
  let opening = false
  return async () => {
    if (opening) return
    if (parts.sessionId.value === null) {
      opening = true
      try {
        const created = await createSession(parts.surfaceKind, parts.refId())
        parts.sessionId.value = created.id
        adoptRow(parts.choice, created)
      } finally {
        opening = false
      }
    }
    parts.isOpen.value = true
    const id = parts.sessionId.value
    if (id !== null) await parts.replay(id)
  }
}

/** 探一次能力：有没有助手、接了哪几路模型。 */
async function probeInto(into: {
  isAvailable: Ref<boolean>
  models: Ref<AssistantModelProfile[]>
  attachmentSuffixes: Ref<string[]>
  choice: Ref<ModelChoice>
}): Promise<void> {
  const ask = aiPorts()?.probe
  if (ask === undefined) return
  const capability = await ask()
  into.isAvailable.value = capability?.is_model_enabled === true
  into.models.value = capability?.models ?? []
  into.attachmentSuffixes.value = capability?.attachment_suffixes ?? []
  fillDefaults(into.choice, capability)
}
