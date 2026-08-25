/**
 * @fileoverview 工作面注册：助手此刻站在哪一页、能读什么、能执行哪些客户端工具。
 *
 * ⚠ 一次只有**一个**工作面。助手跟着用户走，用户只在一个页面上；留一张多面
 * 的表，只会让「助手对着上一页的画布动手」这种事变得可能。
 *
 * ⚠ 页面不注册 = 助手在那一页只能聊天与检索。这与 ports 缺省同一口径：
 * 能力缺席就如实缺席。
 *
 * ⚠ 执行不认识的工具一律**抛**，不静默成功。静默成功会让模型以为改好了，
 * 接着往下走，最后给用户一个「已完成」而画面纹丝不动——那是这套东西最难查
 * 的一类故障（与 @dt/datasources 的 refuseSubscribe 同源）。
 */
import type { AssistantSurfaceKind, AssistantToolCall } from '@dt/contracts'

/** 工作面交出来的一份紧凑快照，直接进提示词。 */
export type SurfaceSnapshot = Record<string, unknown>

export interface AiSurface {
  kind: AssistantSurfaceKind
  /** 给人看的页面名，进提示词。 */
  label: string
  /**
   * 读当前上下文。
   * ⚠ 必须是**摘要**不是整棵树：一屏最多 2000 个画布节点，整份塞进去会把
   * 上下文占满，而被挤掉的是技能正文与工具结果。
   */
  snapshot: () => SurfaceSnapshot
  /** 这一页实现了哪些客户端工具。 */
  tools: readonly string[]
  /** 执行一个客户端工具。不认识的一律抛。 */
  run: (call: AssistantToolCall) => Promise<unknown>
}

export class UnsupportedTool extends Error {
  constructor(name: string) {
    super(`当前页面没有实现 ${name}`)
    this.name = 'UnsupportedTool'
  }
}

let current: AiSurface | null = null

/** 登记当前工作面。页面挂载时调，卸载时记得 `clearSurface`。 */
export function setSurface(surface: AiSurface): void {
  current = surface
}

/** 撤掉当前工作面。⚠ 页面卸载时必须调，否则助手会对着一个已经没了的页面动手。 */
export function clearSurface(kind: AssistantSurfaceKind): void {
  if (current?.kind === kind) current = null
}

/** 当前工作面；没有就给 null。 */
export function activeSurface(): AiSurface | null {
  return current
}

/**
 * 跑一个客户端工具。
 * ⚠ 没有工作面、或这一页没实现这个工具，都**抛**：把「做不到」如实告诉模型，
 * 它下一轮就会换一条路；静默成功则会让它一路自信地错下去。
 * @param call 模型下发的调用
 */
export async function runClientTool(
  call: AssistantToolCall,
): Promise<unknown> {
  const surface = current
  if (surface === null) throw new UnsupportedTool(call.name)
  if (!surface.tools.includes(call.name)) throw new UnsupportedTool(call.name)
  return surface.run(call)
}

/** 只给测试用：回到没有工作面的状态。 */
export function __resetSurfaces(): void {
  current = null
}
