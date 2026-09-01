/**
 * @fileoverview 编辑器全屏预览里的联动引擎：预览的意义就是「按运行态口径看一遍」，
 * 而显隐、互斥切换、弹窗、页签这些全靠联动，不装引擎的话预览里点什么都没反应。
 *
 * ⚠ 引擎只能装在**预览这一棵子树**上，不能提到编辑器页面级：画布上的每一格也走
 * 同一个 ModuleRenderer，页面级 provide 会让设计态点一下模块就真去改显隐、真跳走。
 * ⚠ 跨屏跳转在预览里**不跳**，只说一句：跳走等于把没保存的草稿丢在身后；
 * 但静默不动就是这套一路在躲的「点了没反应」，所以必须出提示。
 */
import { onScopeDispose, provide, ref, watch, type Ref } from 'vue'
import type { DashboardNodePayload } from '@dt/contracts'
import { INTERACTION_KEY, createInteractionRuntime } from '@dt/runtime'

import { parseInteractionRules } from '@/features/dashboard/interactionRules'

/** 跳转提示挂多久（毫秒）；到点自己收，不留一条挡视线的浮条。 */
const JUMP_NOTICE_MS = 3200

export interface PreviewInteraction {
  /** 跨屏跳转的提示语；空串 = 不显示。 */
  jumpNotice: Ref<string>
  /** 当前浮起的节点弹窗；null = 无。 */
  activeModal: ReturnType<typeof createInteractionRuntime>['activeModal']
  /** 关闭弹窗，交给模板上的关闭键。 */
  closeModal: () => void
}

export interface PreviewInteractionInput {
  nodes: () => readonly DashboardNodePayload[]
  /** 页面级外观袋（草稿态），联动规则在它的 `interactions` 一段里。 */
  chromeJson: () => Record<string, unknown>
  /** 正在编辑的这张屏的 id：高亮「当前在哪一格」靠它跟路由目标比。 */
  dashboardId: () => string
}

/**
 * 装上预览用的联动引擎并 provide 给子树。
 * @param input 节点表、外观袋与当前大屏 id，全部以 getter 注入
 */
export function usePreviewInteraction(
  input: PreviewInteractionInput,
): PreviewInteraction {
  const jumpNotice = ref('')
  let noticeTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 跳转在预览里只说不跳。
   * ⚠ 目标就是本屏时一句都不说：运行态在那一档也什么都不做（自跳挡在宿主里），
   * 说了反而是在报告一件根本不会发生的事。
   * @param handle 目标大屏句柄
   */
  function onNavigate(handle: string): void {
    if (handle === input.dashboardId()) return
    jumpNotice.value =
      '这一格会跳到另一张大屏。预览里不跳走，保存后去运行态点它。'
    if (noticeTimer !== null) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => {
      jumpNotice.value = ''
    }, JUMP_NOTICE_MS)
  }

  const interaction = createInteractionRuntime({
    navigate: onNavigate,
    currentHandle: () => input.dashboardId(),
  })
  provide(INTERACTION_KEY, interaction)

  // 草稿一改就重装：预览是开着的时候用户仍能被助手改到节点，规则表也可能刚改完
  watch(
    () => [input.nodes(), input.chromeJson()] as const,
    ([nodes, chromeJson]) => {
      interaction.init(
        parseInteractionRules(chromeJson),
        nodes.map((node) => ({
          nodeId: node.id,
          isVisible: node.isVisible,
        })),
      )
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    if (noticeTimer !== null) clearTimeout(noticeTimer)
    noticeTimer = null
  })

  return {
    jumpNotice,
    activeModal: interaction.activeModal,
    closeModal: () => {
      interaction.closeModal()
    },
  }
}
