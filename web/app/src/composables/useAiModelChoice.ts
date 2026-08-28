/**
 * @fileoverview 面板标题栏那个「用哪一路模型」的下拉背后的一格状态。
 *
 * ⚠ 说了算的是**会话行**，不是能力端点报的 `default_model_id`：后者只是
 * 会话还没建起来时的占位。两处各填各的话，界面显示订阅账号而回合走按量计费，
 * 运行期一点迹象都没有——差异只出现在账单上。
 */
import { ref, type Ref } from 'vue'
import type { AssistantCapability, AssistantSession } from '@dt/contracts'

import { patchSession } from '@/api/assistant'

/** 面板上那个下拉此刻选中的东西。 */
export interface ModelChoice {
  profile: string
  effort: string
}

/** 造一格还没选过的选择。 */
export function newModelChoice(): Ref<ModelChoice> {
  return ref<ModelChoice>({ profile: '', effort: '' })
}

/**
 * 会话还没建起来时，先拿部署的默认占着下拉。
 * ⚠ 只在还没选过时填：填过头会把用户在别的标签页里换的那一路盖回去。
 * @param choice 面板此刻选中的那一路
 * @param capability 探到的能力；探不到时是 null
 */
export function fillDefaults(
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
 * 把服务端那一行的选择抄到下拉上。
 * ⚠ 下拉显示的必须是**行上真正生效的那一路**：显示与生效各算各的话，
 * 差异只会出现在账单上。
 * @param choice 面板此刻选中的那一路
 * @param row 服务端回的会话行；请求没成时是 null
 */
export function adoptRow(
  choice: Ref<ModelChoice>,
  row: AssistantSession | null,
): void {
  if (row === null || row.model_profile === null) return
  choice.value = {
    profile: row.model_profile,
    effort: row.reasoning_effort ?? '',
  }
}

/**
 * 换一路模型。
 * ⚠ 写回**会话**而不是只改这一屏：工具回填那几次推进是循环自己发的，
 * 那时界面手上没有用户的选择。
 * ⚠ 改完以服务端回的那一行为准：换路时思考档那一格是清在本地的，而没带上
 * 这一格的 PATCH 不会动行上的旧值——不抄回来的话，下拉是空的、回合却仍按
 * 行上那一档在跑。
 * @param next 用户刚选的那一路
 * @param choice 面板此刻选中的那一路
 * @param sessionId 这一页的会话；还没建起来时是 null
 */
export async function pickModel(
  next: ModelChoice,
  choice: Ref<ModelChoice>,
  sessionId: Ref<string | null>,
): Promise<void> {
  choice.value = next
  const id = sessionId.value
  if (id === null) return
  adoptRow(
    choice,
    await patchSession(id, {
      model_profile: next.profile,
      ...(next.effort === '' ? {} : { reasoning_effort: next.effort }),
    }),
  )
}
