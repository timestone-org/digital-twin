/**
 * @fileoverview 提问桥：回合循环问一句，对话层把它摆到时间线上，用户点了才回。
 *
 * ⚠ 与 `ports.ts` 同一口径——**没装处理器 = 这套界面接不住提问**，那时如实回
 * 一条「取消」而不是抛：抛出去模型收到的是「工具坏了」，它会去排查一个不存在
 * 的故障；回取消它才知道换个方式往下走（AI_ASSISTANT_ASK_DESIGN §1）。
 *
 * ⚠ 处理器**必须自己收口**。回合被掐掉时挂着的那次提问要被结成取消，否则
 * `runTurn` 永远停在 await 上，界面既不动也不报错，用户只看见输入框一直禁着。
 * 收口的责任在装处理器那一侧（`askQueue.ts`），不在这里：只有它同时握着
 * resolve 与时间线上那张卡片，两处要一起收。
 */
import type { AssistantAskAnswer, AssistantAskRequest } from '@dt/contracts'

/** 界面接住一次提问；用户点了才 resolve。 */
export type AskHandler = (
  request: AssistantAskRequest,
) => Promise<AssistantAskAnswer>

/** 没人接、或者被掐掉时的那条回执。 */
export const ASK_CANCELLED: AssistantAskAnswer = {
  picked: [],
  free_text: null,
  is_cancelled: true,
}

let handler: AskHandler | null = null

/** 装上处理器。重复调用以最后一次为准。 */
export function setAskHandler(next: AskHandler): void {
  handler = next
}

/**
 * 撤掉处理器。
 * ⚠ 只在装的还是自己那一份时才撤：两块面板先后挂载时，后一块撤自己的
 * 不该把前一块的一起撤掉（与 `clearSurface` 同一防法）。
 * @param given 当初装进去的那一份
 */
export function clearAskHandler(given: AskHandler): void {
  if (handler === given) handler = null
}

/**
 * 问用户一句，等他点。
 * @param request 问题与选项
 */
export async function askUser(
  request: AssistantAskRequest,
): Promise<AssistantAskAnswer> {
  const ask = handler
  if (ask === null) return ASK_CANCELLED
  return ask(request)
}

/** 只给测试用：回到没装过的状态。 */
export function __resetAskHandler(): void {
  handler = null
}
