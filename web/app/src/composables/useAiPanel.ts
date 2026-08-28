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
import type { AssistantCapability, AssistantModelProfile } from '@dt/contracts'

import { createSession, patchSession } from '@/api/assistant'
import { newComposeState, type ComposeState } from '@/composables/useAiCompose'
import {
  useAiConversation,
  type AiConversation,
} from '@/composables/useAiConversation'
import { createReplayer } from '@/composables/useAiReplayer'
import { aiPorts } from '@/features/ai/ports'
import { clearSurface, setSurface } from '@/features/ai/surfaces'
import type { AiSurface } from '@/features/ai/surfaces'

export { newComposeState, type ComposeState } from '@/composables/useAiCompose'

export interface AiPanelOptions {
  /** 这一页的工作面。⚠ 只在装配时调一次，句柄要一直有效。 */
  surface: () => AiSurface
  /** 工作面指向的那个东西的 id（大屏 id / 台账 id）；还没加载出来时给 null。 */
  refId: () => string | null
}

/** 面板上那个下拉此刻选中的东西。 */
export interface ModelChoice {
  profile: string
  effort: string
}

export interface AiPanel {
  /** 这套部署到底有没有助手。为假时入口不出现。 */
  isAvailable: Ref<boolean>
  /** 这套部署接了哪几路模型。空 = 不摆那个下拉。 */
  models: Ref<AssistantModelProfile[]>
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
  const choice = ref<ModelChoice>({ profile: '', effort: '' })
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
    void probeInto({ isAvailable, models, choice })
  })

  const open = openerOf({
    surfaceKind: surface.kind,
    refId: options.refId,
    sessionId,
    isOpen,
    replay: replayer.replay,
  })

  return {
    isAvailable,
    models,
    choice,
    pickModel: (next) => picked(next, choice, sessionId),
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
  choice: Ref<ModelChoice>
}): Promise<void> {
  const ask = aiPorts()?.probe
  if (ask === undefined) return
  const capability = await ask()
  into.isAvailable.value = capability?.is_model_enabled === true
  into.models.value = capability?.models ?? []
  fillDefaults(into.choice, capability)
}

/**
 * 还没选过时把部署的默认填上。
 * ⚠ 只在还没选过时填：填过头会把用户在别的标签页里换的那一路盖回去。
 * ⚠ 两格一起填：只填模型那一格的话，默认落在「按量计费 + 不指定思考档」上，
 * 而后端已经把「此刻真能用的那一路」算好了，前端不许再判一次。
 * @param choice 面板此刻选中的那一路
 * @param capability 探到的能力；探不到时是 null
 */
function fillDefaults(
  choice: Ref<ModelChoice>,
  capability: AssistantCapability | null,
): void {
  if (choice.value.profile !== '') return
  choice.value = {
    profile: capability?.default_model_id ?? '',
    effort: capability?.default_effort ?? '',
  }
}

/**
 * 换一路模型。
 * ⚠ 写回**会话**而不是只改这一屏：工具回填那几次推进是循环自己发的，
 * 那时界面手上没有用户的选择。
 */
async function picked(
  next: ModelChoice,
  choice: Ref<ModelChoice>,
  sessionId: Ref<string | null>,
): Promise<void> {
  choice.value = next
  const id = sessionId.value
  if (id === null) return
  await patchSession(id, {
    model_profile: next.profile,
    ...(next.effort === '' ? {} : { reasoning_effort: next.effort }),
  })
}
